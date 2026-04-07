import type { AuthDetails, OAuthAuthDetails } from "./types";

/**
 * Rejects empty values and placeholder strings often produced when
 * `undefined` is stringified into storage or URLSearchParams.
 */
export function isValidOAuthRefreshToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "undefined" &&
    value !== "null"
  );
}

export function isOAuthAuth(auth: AuthDetails): auth is OAuthAuthDetails {
  return (
    auth.type === "oauth" &&
    isValidOAuthRefreshToken((auth as { refresh?: unknown }).refresh)
  );
}

export function calculateTokenExpiry(
  startTimeMs: number,
  expiresInSeconds: number,
): number {
  return startTimeMs + expiresInSeconds * 1000;
}

export function accessTokenExpired(
  auth: OAuthAuthDetails,
  bufferSeconds = 0,
): boolean {
  if (!auth.expires) {
    return true;
  }
  const now = Date.now();
  return auth.expires - bufferSeconds * 1000 <= now;
}
