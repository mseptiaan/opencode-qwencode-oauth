import { createHash, randomBytes } from "node:crypto";
import {
  QWEN_DEFAULT_CLIENT_ID,
  QWEN_DEFAULT_SCOPES,
  QWEN_DEVICE_CODE_ENDPOINT,
  QWEN_OAUTH_BASE_URL,
  QWEN_TOKEN_ENDPOINT,
} from "../constants";
import { calculateTokenExpiry, isValidOAuthRefreshToken } from "../plugin/auth";
import { createLogger } from "../plugin/logger";

const logger = createLogger("oauth");

export interface QwenOAuthOptions {
  clientId: string;
  /** When omitted or empty, {@link QWEN_OAUTH_BASE_URL} is used. */
  oauthBaseUrl?: string;
  scopes?: string[];
}

export interface QwenDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  intervalSeconds: number;
  codeVerifier: string;
}

interface QwenDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

interface QwenTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  resource_url?: string;
}

interface QwenErrorResponse {
  error?: string;
  error_description?: string;
}

export type QwenTokenResult =
  | {
      type: "success";
      access: string;
      refresh: string;
      expires: number;
      resourceUrl?: string;
    }
  | {
      type: "failed";
      error: string;
      code?: string;
      status?: number;
    };

function createOAuthBody(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

function effectiveOAuthBaseUrl(base: string | undefined): string {
  if (typeof base !== "string") {
    return QWEN_OAUTH_BASE_URL;
  }
  const trimmed = base.trim();
  if (!trimmed) {
    return QWEN_OAUTH_BASE_URL;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function resolveOAuthUrl(base: string | undefined, endpoint: string): string {
  const normalized = effectiveOAuthBaseUrl(base);
  logger.debug("resolveOAuthUrl", {
    base: normalized,
    endpoint,
  });
  try {
    return new URL(endpoint, normalized).toString();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid OAuth base URL: ${normalized}. ${message}`);
  }
}

function resolveClientId(clientId: string | undefined): string {
  const trimmed = typeof clientId === "string" ? clientId.trim() : "";
  return trimmed || QWEN_DEFAULT_CLIENT_ID;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(
    createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

export async function authorizeQwenDevice(
  options: QwenOAuthOptions,
): Promise<QwenDeviceAuthorization> {
  const oauthBase = effectiveOAuthBaseUrl(options.oauthBaseUrl);
  logger.debug("authorizeQwenDevice", {
    oauthBaseUrl: oauthBase,
    deviceCodeEndpoint: QWEN_DEVICE_CODE_ENDPOINT,
  });
  const scopes = options.scopes ?? QWEN_DEFAULT_SCOPES;
  const { verifier, challenge } = createPkcePair();
  const response = await fetch(
    resolveOAuthUrl(oauthBase, QWEN_DEVICE_CODE_ENDPOINT),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: createOAuthBody({
        client_id: resolveClientId(options.clientId),
        scope: scopes.join(" "),
        code_challenge: challenge,
        code_challenge_method: "S256",
      }),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to start Qwen device flow");
  }

  const payload = (await response.json()) as QwenDeviceCodeResponse;
  const expiresAt = calculateTokenExpiry(Date.now(), payload.expires_in);
  const intervalSeconds = payload.interval ?? 5;

  return {
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUri: payload.verification_uri,
    verificationUriComplete: payload.verification_uri_complete,
    expiresAt,
    intervalSeconds,
    codeVerifier: verifier,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollQwenDeviceToken(
  options: QwenOAuthOptions,
  deviceCode: string,
  intervalSeconds: number,
  expiresAt: number,
  codeVerifier: string,
): Promise<QwenTokenResult> {
  let currentInterval = intervalSeconds;

  while (Date.now() < expiresAt) {
    const response = await fetch(
      resolveOAuthUrl(options.oauthBaseUrl, QWEN_TOKEN_ENDPOINT),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: createOAuthBody({
          client_id: resolveClientId(options.clientId),
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          code_verifier: codeVerifier,
        }),
      },
    );

    if (response.ok) {
      const payload = (await response.json()) as QwenTokenResponse;
      if (!payload.refresh_token) {
        return { type: "failed", error: "Missing refresh token" };
      }
      return {
        type: "success",
        access: payload.access_token,
        refresh: payload.refresh_token,
        expires: calculateTokenExpiry(Date.now(), payload.expires_in),
        resourceUrl: payload.resource_url,
      };
    }

    const errorPayload = (await response
      .json()
      .catch(() => ({}))) as QwenErrorResponse;
    const code = errorPayload.error;

    if (code === "authorization_pending") {
      await sleep(currentInterval * 1000);
      continue;
    }

    if (code === "slow_down") {
      currentInterval += 5;
      await sleep(currentInterval * 1000);
      continue;
    }

    if (code === "expired_token") {
      return { type: "failed", error: "Device code expired", code };
    }

    return {
      type: "failed",
      error: errorPayload.error_description ?? "OAuth polling failed",
      code,
    };
  }

  return { type: "failed", error: "Device authorization expired" };
}

export async function refreshQwenToken(
  options: QwenOAuthOptions,
  refreshToken: string,
): Promise<QwenTokenResult> {
  const oauthBase = effectiveOAuthBaseUrl(options.oauthBaseUrl);
  logger.debug("refreshQwenToken", {
    oauthBaseUrl: oauthBase,
    tokenEndpoint: QWEN_TOKEN_ENDPOINT,
  });
  if (!isValidOAuthRefreshToken(refreshToken)) {
    return {
      type: "failed",
      error: "Missing or invalid refresh token",
      code: "invalid_request",
      status: 400,
    };
  }

  let response: Response;
  try {
    response = await fetch(resolveOAuthUrl(oauthBase, QWEN_TOKEN_ENDPOINT), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: createOAuthBody({
        client_id: resolveClientId(options.clientId),
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
  } catch (error) {
    logger.debug("Network error during token refresh", { error });
    return {
      type: "failed",
      error: error instanceof Error ? error.message : String(error),
      code: "network_error",
    };
  }

  if (!response.ok) {
    const bodyText = await response.text();
    let errorPayload: QwenErrorResponse = {};
    try {
      errorPayload = JSON.parse(bodyText);
    } catch {
      // Ignore parse error
    }
    logger.debug("Failed to refresh token", {
      url: resolveOAuthUrl(oauthBase, QWEN_TOKEN_ENDPOINT),
      status: response.status,
      bodyRequest: {
        client_id: resolveClientId(options.clientId),
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      },
      bodyResponse: bodyText,
    });
    return {
      type: "failed",
      error: errorPayload.error_description ?? "Failed to refresh token",
      code: errorPayload.error,
      status: response.status,
    };
  }

  const payload = (await response.json()) as QwenTokenResponse;
  return {
    type: "success",
    access: payload.access_token,
    refresh: payload.refresh_token ?? refreshToken,
    expires: calculateTokenExpiry(Date.now(), payload.expires_in),
    resourceUrl: payload.resource_url,
  };
}
