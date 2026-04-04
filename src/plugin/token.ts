import { type QwenOAuthOptions, refreshQwenToken } from "../qwen/oauth";
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
  const result = await refreshQwenToken(options, auth.refresh);

  if (result.type === "failed") {
    throw new QwenTokenRefreshError(result.error, result.code);
  }

  const updated: OAuthAuthDetails = {
    type: "oauth",
    refresh: result.refresh,
    access: result.access,
    expires: result.expires,
    resourceUrl: result.resourceUrl ?? auth.resourceUrl,
  };

  const body = updated as Parameters<PluginClient["auth"]["set"]>[0]["body"];

  await client.auth.set({
    path: { id: providerId },
    body,
  });

  return updated;
}
