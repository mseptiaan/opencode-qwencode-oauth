import type {
  AccountWithMetrics,
  HybridSelectionResult,
  ScoreBreakdown,
} from "./types";

export function calculateHybridScore(
  account: AccountWithMetrics,
  maxTokens: number,
): { score: number; breakdown: ScoreBreakdown } {
  const healthComponent = account.healthScore * 2;
  const tokenComponent = (account.tokens / maxTokens) * 100 * 5;
  const secondsSinceUsed = Math.max(0, (Date.now() - account.lastUsed) / 1000);
  const freshnessComponent = Math.min(secondsSinceUsed, 3600) * 0.1;

  const score = Math.max(
    0,
    healthComponent + tokenComponent + freshnessComponent,
  );

  return {
    score,
    breakdown: {
      health: healthComponent,
      tokens: tokenComponent,
      freshness: freshnessComponent,
    },
  };
}

export function selectHybridAccount(
  accounts: AccountWithMetrics[],
  minHealthScore = 50,
  maxTokens = 50,
): HybridSelectionResult | null {
  const nonRateLimited = accounts.filter((acc) => !acc.isRateLimited);
  if (nonRateLimited.length === 0) {
    return null;
  }

  const idealCandidates = nonRateLimited.filter(
    (acc) => acc.healthScore >= minHealthScore && acc.tokens >= 1,
  );

  const candidatesToScore =
    idealCandidates.length > 0 ? idealCandidates : nonRateLimited;

  const scored = candidatesToScore
    .map((acc) => {
      const { score, breakdown } = calculateHybridScore(acc, maxTokens);
      return {
        index: acc.index,
        score,
        breakdown,
      };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0] ?? null;
}
