import type { Plugin } from "@opencode-ai/plugin";
import { QWEN_DEFAULT_SCOPES, QWEN_OAUTH_BASE_URL } from "./constants";
import {
  type AccountStorage,
  getMinRateLimitWait,
  loadAccounts,
  markRateLimited,
  recordFailure,
  recordSuccess,
  type SelectAccountOptions,
  saveAccounts,
  selectAccount,
  updateAccount,
  upsertAccount,
} from "./plugin/account";
import { accessTokenExpired, isOAuthAuth } from "./plugin/auth";
import { type LoadedConfig, loadConfig } from "./plugin/config";
import {
  createLogger,
  initDebugFromEnv,
  setLoggerQuietMode,
} from "./plugin/logger";
import {
  getHealthTracker,
  getTokenTracker,
  initHealthTracker,
  initTokenTracker,
} from "./plugin/rotation";
import { type QwenTokenRefreshError, refreshAccessToken } from "./plugin/token";
import type {
  AuthDetails,
  GetAuth,
  OAuthAuthDetails,
  PluginContext,
  Provider,
} from "./plugin/types";
import {
  authorizeQwenDevice,
  pollQwenDeviceToken,
  type QwenOAuthOptions,
} from "./qwen/oauth";
import { transformResponsesToChatCompletions } from "./transform/request";
import {
  createTransformContext,
  transformChatCompletionsToResponses,
} from "./transform/response";
import {
  createSSETransformContext,
  createSSETransformStream,
} from "./transform/sse";

const logger = createLogger("plugin");

function normalizeUrl(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function buildOAuthOptions(
  config: ReturnType<typeof loadConfig>,
): QwenOAuthOptions {
  return {
    clientId: config.client_id,
    oauthBaseUrl: normalizeUrl(config.oauth_base_url, QWEN_OAUTH_BASE_URL),
    scopes: QWEN_DEFAULT_SCOPES,
  };
}

function ensureStorage(auth: OAuthAuthDetails): AccountStorage {
  return {
    version: 1,
    accounts: [
      {
        refreshToken: auth.refresh,
        accessToken: auth.access,
        expires: auth.expires,
        resourceUrl: auth.resourceUrl,
        addedAt: Date.now(),
        lastUsed: Date.now(),
      },
    ],
    activeIndex: 0,
  };
}

function sanitizeMalformedUrl(url: string): string {
  let result = url.trim();

  // Strip leading sentinel prefix (undefined/null) only at start
  // OpenCode may pass "undefined/chat/completions" when provider has no baseUrl
  result = result.replace(/^(undefined|null)(?=\/|$)/, "");

  // Prevent protocol-relative URL after stripping (e.g., "undefined//path" -> "//path" is dangerous)
  // Collapse multiple leading slashes to single slash
  if (result.startsWith("//")) {
    result = `/${result.replace(/^\/+/, "")}`;
  }

  return result;
}

function applyResourceUrl(
  input: RequestInfo | URL,
  baseUrl?: string,
): { url: string } {
  let rawUrl: string;
  if (typeof input === "string") {
    rawUrl = input;
  } else if (input instanceof URL) {
    rawUrl = input.toString();
  } else {
    rawUrl = input.url;
  }

  // Sanitize malformed URLs from OpenCode (e.g., "undefined/chat/completions")
  rawUrl = sanitizeMalformedUrl(rawUrl);

  // If sanitization resulted in empty string, treat as root path
  if (!rawUrl) {
    rawUrl = "/";
  }

  let originalUrl: URL;
  try {
    originalUrl = new URL(rawUrl);
  } catch {
    if (!baseUrl) {
      throw new Error(`Qwen OAuth requires a base URL for ${rawUrl}`);
    }
    originalUrl = new URL(rawUrl, baseUrl);
  }

  if (!baseUrl) {
    return { url: originalUrl.toString() };
  }

  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/$/, "");
  const originalPath = originalUrl.pathname;

  let combinedPath = originalPath;
  if (originalPath.startsWith(basePath)) {
    combinedPath = `${basePath}${originalPath.slice(basePath.length)}`;
  } else {
    combinedPath = `${basePath}${originalPath.startsWith("/") ? "" : "/"}${originalPath}`;
  }

  base.pathname = combinedPath;
  base.search = originalUrl.search;
  base.hash = originalUrl.hash;

  return { url: base.toString() };
}

function extractRetryAfterMs(response: Response): number | null {
  const retryAfterMs = response.headers.get("retry-after-ms");
  if (retryAfterMs) {
    const value = Number.parseInt(retryAfterMs, 10);
    if (!Number.isNaN(value) && value > 0) {
      return value;
    }
  }

  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const value = Number.parseInt(retryAfter, 10);
    if (!Number.isNaN(value) && value > 0) {
      return value * 1000;
    }
  }

  return null;
}

type RateLimitReason =
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMIT_EXCEEDED"
  | "SERVER_ERROR"
  | "UNKNOWN";

const BACKOFF_TIERS: Record<RateLimitReason, number[]> = {
  QUOTA_EXHAUSTED: [60_000, 300_000, 1800_000],
  RATE_LIMIT_EXCEEDED: [30_000, 60_000],
  SERVER_ERROR: [20_000, 40_000],
  UNKNOWN: [60_000],
};

function parseRateLimitReason(response: Response): RateLimitReason {
  const errorHeader = response.headers.get("x-error-code");
  if (errorHeader) {
    const upper = errorHeader.toUpperCase();
    if (upper.includes("QUOTA")) return "QUOTA_EXHAUSTED";
    if (upper.includes("RATE")) return "RATE_LIMIT_EXCEEDED";
    if (upper.includes("SERVER") || upper.includes("CAPACITY"))
      return "SERVER_ERROR";
  }
  if (response.status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

function getBackoffMs(
  reason: RateLimitReason,
  consecutiveFailures: number,
): number {
  const tier = BACKOFF_TIERS[reason];
  return tier[Math.min(consecutiveFailures, tier.length - 1)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureAuthInStorage(
  storage: AccountStorage | null,
  auth: OAuthAuthDetails,
): Promise<AccountStorage> {
  const now = Date.now();
  const baseStorage = storage ?? ensureStorage(auth);
  const updated = upsertAccount(baseStorage, {
    refreshToken: auth.refresh,
    accessToken: auth.access,
    expires: auth.expires,
    resourceUrl: auth.resourceUrl,
    addedAt: now,
    lastUsed: now,
  });
  await saveAccounts(updated);
  return updated;
}

function initializeTrackers(config: LoadedConfig): void {
  initHealthTracker(
    config.health_score
      ? {
          initial: config.health_score.initial,
          successReward: config.health_score.success_reward,
          rateLimitPenalty: config.health_score.rate_limit_penalty,
          failurePenalty: config.health_score.failure_penalty,
          recoveryRatePerHour: config.health_score.recovery_rate_per_hour,
          minUsable: config.health_score.min_usable,
        }
      : undefined,
  );
  initTokenTracker(
    config.token_bucket
      ? {
          maxTokens: config.token_bucket.max_tokens,
          regenerationRatePerMinute:
            config.token_bucket.regeneration_rate_per_minute,
        }
      : undefined,
  );
}

function getPidOffset(config: LoadedConfig): number {
  if (!config.pid_offset_enabled) return 0;
  return process.pid;
}

export const createQwenOAuthPlugin =
  (providerId: string): Plugin =>
  async ({ client, directory }: PluginContext) => {
    const config = loadConfig(directory);
    setLoggerQuietMode(config.quiet_mode);
    initDebugFromEnv();
    initializeTrackers(config);

    const pidOffset = getPidOffset(config);
    logger.debug("Plugin initialized", {
      providerId,
      directory,
      strategy: config.rotation_strategy,
      pidOffset: config.pid_offset_enabled ? pidOffset : "disabled",
    });

    const oauthOptions = buildOAuthOptions(config);

    return {
      auth: {
        provider: providerId,
        async loader(getAuth: GetAuth, provider: Provider) {
          const auth = (await getAuth()) as AuthDetails;
          if (!isOAuthAuth(auth)) {
            return {};
          }

          let accountStorage = await ensureAuthInStorage(
            await loadAccounts(),
            auth,
          );

          if (provider.models) {
            for (const model of Object.values(provider.models)) {
              if (model) {
                model.cost = {
                  input: 0,
                  output: 0,
                  cache: { read: 0, write: 0 },
                };
              }
            }
          }

          return {
            apiKey: "",
            fetch: async (
              input: RequestInfo | URL,
              init?: RequestInit,
            ): Promise<Response> => {
              let attempts = 0;
              const healthTracker = getHealthTracker();
              const tokenTracker = getTokenTracker();
              const selectOptions: SelectAccountOptions = {
                healthTracker,
                tokenTracker,
                pidOffset,
              };

              while (true) {
                const now = Date.now();
                const selection = selectAccount(
                  accountStorage,
                  config.rotation_strategy,
                  now,
                  selectOptions,
                );

                if (!selection) {
                  const waitMs = getMinRateLimitWait(accountStorage, now);
                  if (!waitMs) {
                    throw new Error(
                      "No available Qwen OAuth accounts. Re-authenticate to continue.",
                    );
                  }

                  const maxWaitMs =
                    (config.max_rate_limit_wait_seconds ?? 0) * 1000;
                  if (maxWaitMs > 0 && waitMs > maxWaitMs) {
                    throw new Error(
                      "All Qwen OAuth accounts are rate-limited. Try again later.",
                    );
                  }

                  await sleep(waitMs);
                  continue;
                }

                accountStorage = selection.storage;
                const account = selection.account;
                const accountIndex = selection.index;

                const authRecord: OAuthAuthDetails = {
                  type: "oauth",
                  refresh: account.refreshToken,
                  access: account.accessToken,
                  expires: account.expires,
                  resourceUrl: account.resourceUrl,
                };

                const refreshBuffer = config.proactive_refresh
                  ? config.refresh_window_seconds
                  : 0;
                if (
                  !authRecord.access ||
                  accessTokenExpired(authRecord, refreshBuffer)
                ) {
                  logger.debug("Token refresh needed", {
                    accountIndex,
                    hasAccess: !!authRecord.access,
                    proactive: config.proactive_refresh,
                  });
                  try {
                    const refreshed = await refreshAccessToken(
                      authRecord,
                      oauthOptions,
                      client,
                      providerId,
                    );
                    if (!refreshed) {
                      throw new Error("Token refresh failed");
                    }
                    logger.debug("Token refreshed successfully", {
                      accountIndex,
                    });
                    accountStorage = updateAccount(
                      accountStorage,
                      accountIndex,
                      {
                        refreshToken: refreshed.refresh,
                        accessToken: refreshed.access,
                        expires: refreshed.expires,
                        resourceUrl:
                          refreshed.resourceUrl ?? account.resourceUrl,
                        lastUsed: now,
                      },
                    );
                    await saveAccounts(accountStorage);
                  } catch (error) {
                    const refreshError = error as QwenTokenRefreshError;
                    logger.debug("Token refresh failed", {
                      accountIndex,
                      code: refreshError.code,
                    });
                    if (refreshError.code === "invalid_grant") {
                      accountStorage = updateAccount(
                        accountStorage,
                        accountIndex,
                        { rateLimitResetAt: Date.now() + 60_000 },
                      );
                      await saveAccounts(accountStorage);
                    }
                    attempts += 1;
                    if (attempts >= accountStorage.accounts.length) {
                      throw error;
                    }
                    continue;
                  }
                }

                const latestAuth = (await getAuth()) as AuthDetails;
                if (!isOAuthAuth(latestAuth)) {
                  return fetch(input, init);
                }

                const activeAuth = latestAuth.access ? latestAuth : authRecord;

                // Get URL from input - OpenCode already constructs full URLs
                let rawUrl: string;
                if (typeof input === "string") {
                  rawUrl = input;
                } else if (input instanceof URL) {
                  rawUrl = input.toString();
                } else {
                  rawUrl = input.url;
                }

                // Sanitize malformed URLs (e.g., "undefined/path")
                rawUrl = sanitizeMalformedUrl(rawUrl);

                let requestInit =
                  init ??
                  (input instanceof Request
                    ? {
                        method: input.method,
                        headers: input.headers,
                        body: input.body,
                        signal: input.signal,
                      }
                    : undefined);

                if (!requestInit && !(input instanceof Request)) {
                  requestInit = {};
                }

                if (requestInit && !(requestInit as RequestInit).headers) {
                  (requestInit as RequestInit).headers = {};
                }

                const headers = new Headers(requestInit?.headers);
                if (activeAuth.access) {
                  headers.set("Authorization", `Bearer ${activeAuth.access}`);
                }

                const needsResponsesTransform = rawUrl.endsWith("/responses");
                const finalUrl = rawUrl.replace(
                  /\/responses$/,
                  "/chat/completions",
                );

                const finalInit = { ...requestInit };
                if (needsResponsesTransform && requestInit?.body) {
                  try {
                    const bodyStr =
                      typeof requestInit.body === "string"
                        ? requestInit.body
                        : await new Response(requestInit.body).text();
                    const body = JSON.parse(bodyStr);
                    const transformed =
                      transformResponsesToChatCompletions(body);
                    finalInit.body = JSON.stringify(transformed);
                    logger.verbose("Transformed request body", {
                      messagesCount: transformed.messages?.length,
                      hasTools: !!transformed.tools,
                    });
                  } catch {
                    logger.debug("Body parse failed, using original");
                  }
                }

                logger.debug("Sending request", {
                  url: finalUrl,
                  method: finalInit.method ?? "POST",
                  needsTransform: needsResponsesTransform,
                });

                const response = await fetch(finalUrl, {
                  ...finalInit,
                  headers,
                });

                logger.debug("Response received", {
                  status: response.status,
                  contentType: response.headers.get("content-type"),
                });

                // Transform streaming response from Chat Completions to Responses API format
                if (
                  needsResponsesTransform &&
                  response.ok &&
                  response.body &&
                  response.headers
                    .get("content-type")
                    ?.includes("text/event-stream")
                ) {
                  const sseCtx = createSSETransformContext(logger);
                  const transformStream = createSSETransformStream(sseCtx);
                  const transformedBody =
                    response.body.pipeThrough(transformStream);
                  return new Response(transformedBody, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                  });
                }

                if (
                  needsResponsesTransform &&
                  response.ok &&
                  !response.headers
                    .get("content-type")
                    ?.includes("text/event-stream")
                ) {
                  logger.debug("Transforming non-streaming response");
                  const chatBody = await response.json();
                  const ctx = createTransformContext();
                  const responsesBody = transformChatCompletionsToResponses(
                    chatBody,
                    ctx,
                  );

                  return new Response(JSON.stringify(responsesBody), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: new Headers({
                      "content-type": "application/json",
                    }),
                  });
                }

                if (response.status === 429 || response.status >= 500) {
                  const reason = parseRateLimitReason(response);
                  const headerMs = extractRetryAfterMs(response);
                  const tieredMs = getBackoffMs(reason, attempts);
                  const retryAfterMs = headerMs ?? tieredMs;

                  logger.debug("Rate limited or server error", {
                    status: response.status,
                    reason,
                    accountIndex,
                    retryAfterMs,
                    attempts,
                    totalAccounts: accountStorage.accounts.length,
                  });

                  accountStorage = markRateLimited(
                    accountStorage,
                    accountIndex,
                    retryAfterMs,
                  );
                  accountStorage = recordFailure(accountStorage, accountIndex);
                  if (response.status === 429) {
                    healthTracker.recordRateLimit(accountIndex);
                  } else {
                    healthTracker.recordFailure(accountIndex);
                  }
                  await saveAccounts(accountStorage);
                  attempts += 1;
                  if (attempts >= accountStorage.accounts.length) {
                    const waitMs = getMinRateLimitWait(
                      accountStorage,
                      Date.now(),
                    );
                    if (waitMs) {
                      logger.debug("All accounts rate limited, waiting", {
                        waitMs,
                      });
                      await sleep(waitMs);
                      attempts = 0;
                      continue;
                    }
                    return response;
                  }
                  continue;
                }

                accountStorage = recordSuccess(accountStorage, accountIndex);
                healthTracker.recordSuccess(accountIndex);
                await saveAccounts(accountStorage);
                return response;
              }
            },
          };
        },
        methods: [
          {
            label: "Qwen OAuth",
            type: "oauth",
            authorize: async () => {
              const device = await authorizeQwenDevice(oauthOptions);
              const url =
                device.verificationUriComplete ?? device.verificationUri;
              const instructions = `Open ${device.verificationUri} and enter code ${device.userCode}`;

              return {
                url,
                method: "auto",
                instructions,
                callback: async () => {
                  const result = await pollQwenDeviceToken(
                    oauthOptions,
                    device.deviceCode,
                    device.intervalSeconds,
                    device.expiresAt,
                    device.codeVerifier,
                  );
                  if (result.type === "success") {
                    return {
                      type: "success",
                      refresh: result.refresh,
                      access: result.access,
                      expires: result.expires,
                      resourceUrl: result.resourceUrl,
                    };
                  }
                  return { type: "failed", error: result.error };
                },
              };
            },
          },
        ],
      },
    };
  };

export const QwenCLIOAuthPlugin = createQwenOAuthPlugin("qwen");
export const QwenOAuthPlugin = QwenCLIOAuthPlugin;

export { sanitizeMalformedUrl, applyResourceUrl };

export default QwenOAuthPlugin;
