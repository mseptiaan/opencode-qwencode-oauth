/**
 * Account Rotation System
 *
 * Implements advanced account selection algorithms:
 * - Health Score: Track account wellness based on success/failure
 * - Token Bucket: Client-side rate limiting to prevent 429s
 * - LRU Selection: Prefer accounts with longest rest periods
 * - Hybrid Selection: Weighted combination of all signals
 *
 * Used by 'hybrid' strategy for improved load distribution.
 */

// ============================================================================
// HEALTH SCORE SYSTEM
// ============================================================================

export interface HealthScoreConfig {
  /** Initial score for new accounts (default: 70) */
  initial: number;
  /** Points added on successful request (default: 1) */
  successReward: number;
  /** Points removed on rate limit (default: -10) */
  rateLimitPenalty: number;
  /** Points removed on failure (auth, network, etc.) (default: -20) */
  failurePenalty: number;
  /** Points recovered per hour of rest (default: 2) */
  recoveryRatePerHour: number;
  /** Minimum score to be considered usable (default: 50) */
  minUsable: number;
  /** Maximum score cap (default: 100) */
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

/**
 * Tracks health scores for accounts.
 * Higher score = healthier account = preferred for selection.
 */
export class HealthScoreTracker {
  private readonly scores = new Map<number, HealthScoreState>();
  readonly config: HealthScoreConfig;

  constructor(config: Partial<HealthScoreConfig> = {}) {
    this.config = { ...DEFAULT_HEALTH_SCORE_CONFIG, ...config };
  }

  /**
   * Get current health score for an account, applying time-based recovery.
   */
  getScore(accountIndex: number): number {
    const state = this.scores.get(accountIndex);
    if (!state) {
      return this.config.initial;
    }

    // Apply passive recovery based on time since last update
    const now = Date.now();
    const hoursSinceUpdate = (now - state.lastUpdated) / (1000 * 60 * 60);
    const recoveredPoints = Math.floor(
      hoursSinceUpdate * this.config.recoveryRatePerHour,
    );

    return Math.min(this.config.maxScore, state.score + recoveredPoints);
  }

  /**
   * Record a successful request - improves health score.
   */
  recordSuccess(accountIndex: number): void {
    const now = Date.now();
    const current = this.getScore(accountIndex);

    this.scores.set(accountIndex, {
      score: Math.min(
        this.config.maxScore,
        current + this.config.successReward,
      ),
      lastUpdated: now,
      lastSuccess: now,
      consecutiveFailures: 0,
    });
  }

  /**
   * Record a rate limit hit - moderate penalty.
   */
  recordRateLimit(accountIndex: number): void {
    const now = Date.now();
    const state = this.scores.get(accountIndex);
    const current = this.getScore(accountIndex);

    this.scores.set(accountIndex, {
      score: Math.max(0, current + this.config.rateLimitPenalty),
      lastUpdated: now,
      lastSuccess: state?.lastSuccess ?? 0,
      consecutiveFailures: (state?.consecutiveFailures ?? 0) + 1,
    });
  }

  /**
   * Record a failure (auth, network, etc.) - larger penalty.
   */
  recordFailure(accountIndex: number): void {
    const now = Date.now();
    const state = this.scores.get(accountIndex);
    const current = this.getScore(accountIndex);

    this.scores.set(accountIndex, {
      score: Math.max(0, current + this.config.failurePenalty),
      lastUpdated: now,
      lastSuccess: state?.lastSuccess ?? 0,
      consecutiveFailures: (state?.consecutiveFailures ?? 0) + 1,
    });
  }

  /**
   * Check if account is healthy enough to use.
   */
  isUsable(accountIndex: number): boolean {
    return this.getScore(accountIndex) >= this.config.minUsable;
  }

  /**
   * Get consecutive failure count for an account.
   */
  getConsecutiveFailures(accountIndex: number): number {
    return this.scores.get(accountIndex)?.consecutiveFailures ?? 0;
  }

  /**
   * Reset health state for an account (e.g., after removal).
   */
  reset(accountIndex: number): void {
    this.scores.delete(accountIndex);
  }

  /**
   * Export state for persistence.
   */
  toJSON(): Record<string, HealthScoreState> {
    const result: Record<string, HealthScoreState> = {};
    for (const [index, state] of this.scores) {
      result[String(index)] = { ...state };
    }
    return result;
  }

  /**
   * Load state from persisted data.
   */
  loadFromJSON(data: Record<string, HealthScoreState>): void {
    this.scores.clear();
    for (const [key, state] of Object.entries(data)) {
      const index = Number.parseInt(key, 10);
      if (!Number.isNaN(index) && state) {
        this.scores.set(index, { ...state });
      }
    }
  }

  /**
   * Get all scores for debugging/logging.
   */
  getSnapshot(): Map<number, { score: number; consecutiveFailures: number }> {
    const result = new Map<
      number,
      { score: number; consecutiveFailures: number }
    >();
    for (const [index] of this.scores) {
      result.set(index, {
        score: this.getScore(index),
        consecutiveFailures: this.getConsecutiveFailures(index),
      });
    }
    return result;
  }
}

// ============================================================================
// TOKEN BUCKET SYSTEM
// ============================================================================

export interface TokenBucketConfig {
  /** Maximum tokens per account (default: 50) */
  maxTokens: number;
  /** Tokens regenerated per minute (default: 6) */
  regenerationRatePerMinute: number;
  /** Initial tokens for new accounts (default: 50) */
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

/**
 * Client-side rate limiting using Token Bucket algorithm.
 * Helps prevent hitting server 429s by tracking "cost" of requests.
 */
export class TokenBucketTracker {
  private readonly buckets = new Map<number, TokenBucketState>();
  private readonly config: TokenBucketConfig;

  constructor(config: Partial<TokenBucketConfig> = {}) {
    this.config = { ...DEFAULT_TOKEN_BUCKET_CONFIG, ...config };
  }

  /**
   * Get current token balance for an account, applying regeneration.
   */
  getTokens(accountIndex: number): number {
    const state = this.buckets.get(accountIndex);
    if (!state) {
      return this.config.initialTokens;
    }

    const now = Date.now();
    const minutesSinceUpdate = (now - state.lastUpdated) / (1000 * 60);
    const recoveredTokens =
      minutesSinceUpdate * this.config.regenerationRatePerMinute;

    return Math.min(this.config.maxTokens, state.tokens + recoveredTokens);
  }

  /**
   * Check if account has enough tokens for a request.
   * @param cost Cost of the request (default: 1)
   */
  hasTokens(accountIndex: number, cost = 1): boolean {
    return this.getTokens(accountIndex) >= cost;
  }

  /**
   * Consume tokens for a request.
   * @returns true if tokens were consumed, false if insufficient
   */
  consume(accountIndex: number, cost = 1): boolean {
    const current = this.getTokens(accountIndex);
    if (current < cost) {
      return false;
    }

    this.buckets.set(accountIndex, {
      tokens: current - cost,
      lastUpdated: Date.now(),
    });
    return true;
  }

  /**
   * Refund tokens (e.g., if request wasn't actually sent).
   */
  refund(accountIndex: number, amount = 1): void {
    const current = this.getTokens(accountIndex);
    this.buckets.set(accountIndex, {
      tokens: Math.min(this.config.maxTokens, current + amount),
      lastUpdated: Date.now(),
    });
  }

  /**
   * Get max tokens config value.
   */
  getMaxTokens(): number {
    return this.config.maxTokens;
  }

  /**
   * Export state for persistence.
   */
  toJSON(): Record<string, TokenBucketState> {
    const result: Record<string, TokenBucketState> = {};
    for (const [index, state] of this.buckets) {
      result[String(index)] = { ...state };
    }
    return result;
  }

  /**
   * Load state from persisted data.
   */
  loadFromJSON(data: Record<string, TokenBucketState>): void {
    this.buckets.clear();
    for (const [key, state] of Object.entries(data)) {
      const index = Number.parseInt(key, 10);
      if (!Number.isNaN(index) && state) {
        this.buckets.set(index, { ...state });
      }
    }
  }
}

// ============================================================================
// HYBRID SELECTION
// ============================================================================

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

/**
 * Calculate hybrid score for an account.
 * Score = (health × 2) + (tokens × 5) + (freshness × 0.1)
 *
 * Weight breakdown:
 * - Token balance: 50% influence (500 points max)
 * - Health score: 20% influence (200 points max)
 * - Freshness (LRU): 36% influence (360 points max)
 */
export function calculateHybridScore(
  account: AccountWithMetrics,
  maxTokens: number,
): { score: number; breakdown: ScoreBreakdown } {
  const healthComponent = account.healthScore * 2; // 0-200
  const tokenComponent = (account.tokens / maxTokens) * 100 * 5; // 0-500
  const secondsSinceUsed = Math.max(0, (Date.now() - account.lastUsed) / 1000);
  const freshnessComponent = Math.min(secondsSinceUsed, 3600) * 0.1; // 0-360

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

/**
 * Select account using hybrid strategy.
 *
 * Algorithm:
 * 1. Filter available accounts (not rate-limited, healthy, has tokens)
 * 2. Calculate priority score for each
 * 3. Sort by score descending
 * 4. Return the best candidate (deterministic - highest score)
 *
 * @param accounts - All accounts with their metrics
 * @param minHealthScore - Minimum health score to be considered (default: 50)
 * @param maxTokens - Maximum tokens for percentage calculation (default: 50)
 * @returns Best account selection result, or null if none available
 */
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

// ============================================================================
// SINGLETON TRACKERS
// ============================================================================

let globalHealthTracker: HealthScoreTracker | null = null;
let globalTokenTracker: TokenBucketTracker | null = null;

/**
 * Get the global health score tracker instance.
 * Creates one with default config if not initialized.
 */
export function getHealthTracker(): HealthScoreTracker {
  if (!globalHealthTracker) {
    globalHealthTracker = new HealthScoreTracker();
  }
  return globalHealthTracker;
}

/**
 * Initialize the global health tracker with custom config.
 * Call this at plugin startup if custom config is needed.
 */
export function initHealthTracker(
  config?: Partial<HealthScoreConfig>,
): HealthScoreTracker {
  globalHealthTracker = new HealthScoreTracker(config);
  return globalHealthTracker;
}

/**
 * Get the global token bucket tracker instance.
 * Creates one with default config if not initialized.
 */
export function getTokenTracker(): TokenBucketTracker {
  if (!globalTokenTracker) {
    globalTokenTracker = new TokenBucketTracker();
  }
  return globalTokenTracker;
}

/**
 * Initialize the global token tracker with custom config.
 * Call this at plugin startup if custom config is needed.
 */
export function initTokenTracker(
  config?: Partial<TokenBucketConfig>,
): TokenBucketTracker {
  globalTokenTracker = new TokenBucketTracker(config);
  return globalTokenTracker;
}

/**
 * Reset all global trackers. Used for testing.
 */
export function resetTrackers(): void {
  globalHealthTracker = null;
  globalTokenTracker = null;
}
