export interface HealthScoreConfig {
  initial: number;
  successReward: number;
  rateLimitPenalty: number;
  failurePenalty: number;
  recoveryRatePerHour: number;
  minUsable: number;
  maxScore: number;
}

export const DEFAULT_HEALTH_SCORE_CONFIG: HealthScoreConfig = {
  initial: 70,
  successReward: 1,
  rateLimitPenalty: -10,
  failurePenalty: -20,
  recoveryRatePerHour: 2,
  minUsable: 50,
  maxScore: 100,
};

export interface HealthScoreState {
  score: number;
  lastUpdated: number;
  lastSuccess: number;
  consecutiveFailures: number;
}

export interface TokenBucketConfig {
  maxTokens: number;
  regenerationRatePerMinute: number;
  initialTokens: number;
}

export const DEFAULT_TOKEN_BUCKET_CONFIG: TokenBucketConfig = {
  maxTokens: 50,
  regenerationRatePerMinute: 6,
  initialTokens: 50,
};

export interface TokenBucketState {
  tokens: number;
  lastUpdated: number;
}

export interface AccountWithMetrics {
  index: number;
  lastUsed: number;
  healthScore: number;
  tokens: number;
  isRateLimited: boolean;
}

export interface ScoreBreakdown {
  health: number;
  tokens: number;
  freshness: number;
}

export interface HybridSelectionResult {
  index: number;
  score: number;
  breakdown: ScoreBreakdown;
}

export interface AdaptiveConfig {
  learningRate: number;
  historyWindow: number;
  minWeight: number;
  maxWeight: number;
  cooldownPeriodMs: number;
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveConfig = {
  learningRate: 0.1,
  historyWindow: 10,
  minWeight: 0.1,
  maxWeight: 1.0,
  cooldownPeriodMs: 300_000,
};

export interface AdaptiveState {
  weight: number;
  rateLimitTimestamps: number[];
  lastAdjustment: number;
}

export interface AdaptiveSelectionResult {
  index: number;
  weight: number;
  score: number;
}

export type SelectionResult =
  | { strategy: "hybrid"; result: HybridSelectionResult }
  | { strategy: "adaptive"; result: AdaptiveSelectionResult }
  | { strategy: "round-robin" | "sequential"; result: { index: number } };
