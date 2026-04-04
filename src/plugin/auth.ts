import type { AuthDetails, OAuthAuthDetails } from "./types";

export function isOAuthAuth(auth: AuthDetails): auth is OAuthAuthDetails {
  return (
    auth.type === "oauth" &&
    typeof auth.refresh === "string" &&
    auth.refresh.length > 0
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
