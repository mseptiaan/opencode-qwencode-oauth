import { type QwenOAuthOptions, refreshQwenToken } from "../../qwen/oauth";
import { isValidOAuthRefreshToken } from "../auth";
import type { OAuthAuthDetails } from "../types";

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
): Promise<OAuthAuthDetails | null> {
  if (!isValidOAuthRefreshToken(auth.refresh)) {
    throw new QwenTokenRefreshError(
      "Missing or invalid refresh token; re-authenticate with Qwen OAuth.",
      "invalid_request",
    );
  }

  const result = await refreshQwenToken(options, auth.refresh);

  if (result.type === "failed") {
    throw new QwenTokenRefreshError(result.error, result.code);
  }

  return {
    type: "oauth",
    refresh: result.refresh,
    access: result.access,
    expires: result.expires,
    resourceUrl: result.resourceUrl ?? auth.resourceUrl,
  };
}
