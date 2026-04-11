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

export function extractRetryAfterMs(response: Response): number | null {
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

export function parseRateLimitReason(response: Response): RateLimitReason {
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

export function getBackoffMs(
  reason: RateLimitReason,
  consecutiveFailures: number,
): number {
  const tier = BACKOFF_TIERS[reason];
  return tier[Math.min(consecutiveFailures, tier.length - 1)];
}

export function calculateBackoff(response: Response, attempt: number): number {
  const reason = parseRateLimitReason(response);
  const headerMs = extractRetryAfterMs(response);
  const tieredMs = getBackoffMs(reason, attempt);
  return headerMs ?? tieredMs;
}

export function isRateLimitedOrServerError(status: number): boolean {
  return status === 429 || status >= 500;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
