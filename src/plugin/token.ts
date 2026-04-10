import { QwenAuthClient, type QwenOAuthOptions } from "../qwen/oauth";
import { isValidOAuthRefreshToken } from "./auth";
import {
  SharedTokenManager,
  TokenManagerError,
} from "../qwen/sharedTokenManager";
import type { OAuthAuthDetails, PluginClient } from "./types";

export class QwenTokenRefreshError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "QwenTokenRefreshError";
    this.code = code;
  }
}

export async function refreshAccessToken(
  auth: OAuthAuthDetails,
  options: QwenOAuthOptions,
  client: PluginClient,
  providerId: string,
): Promise<OAuthAuthDetails | null> {
  if (!isValidOAuthRefreshToken(auth.refresh)) {
    throw new QwenTokenRefreshError(
      "Missing or invalid refresh token; re-authenticate with Qwen OAuth.",
      "invalid_request",
    );
  }

  const authClient = new QwenAuthClient(options, {
    access_token: auth.access || "",
    refresh_token: auth.refresh as string,
    token_type: "Bearer",
    expiry_date: auth.expires,
    resource_url: auth.resourceUrl,
  });

  const manager = SharedTokenManager.getInstance();

  try {
    const result = await manager.getValidCredentials(authClient, false); // forceRefresh=false because we only want to refresh if it's actually expired or missing

    const updated: OAuthAuthDetails = {
      type: "oauth",
      refresh: result.refresh_token!,
      access: result.access_token,
      expires: result.expiry_date!,
      resourceUrl: result.resource_url ?? auth.resourceUrl,
    };

    const body = updated as Parameters<PluginClient["auth"]["set"]>[0]["body"];

    await client.auth.set({
      path: { id: providerId },
      body,
    });

    return updated;
  } catch (error) {
    if (error instanceof TokenManagerError) {
      throw new QwenTokenRefreshError(error.message, error.type);
    }
    throw new QwenTokenRefreshError(
      error instanceof Error ? error.message : "Failed to refresh token",
    );
  }
}
