import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  type AccountWithMetrics,
  calculateHybridScore,
  DEFAULT_HEALTH_SCORE_CONFIG,
  DEFAULT_TOKEN_BUCKET_CONFIG,
  HealthScoreTracker,
  resetTrackers,
  selectHybridAccount,
  TokenBucketTracker,
} from "../src/plugin/rotation";

const TOKEN_PRECISION = 2;

function expectTokensClose(
  actual: number,
  expected: number,
  precision = TOKEN_PRECISION,
): void {
  expect(actual).toBeCloseTo(expected, precision);
}

describe("HealthScoreTracker", () => {
  let tracker: HealthScoreTracker;

  beforeEach(() => {
    tracker = new HealthScoreTracker();
  });

  describe("initial state", () => {
    it("returns initial score (70) for new accounts", () => {
      expect(tracker.getScore(0)).toBe(70);
      expect(tracker.getScore(99)).toBe(70);
    });

    it("marks new accounts as usable", () => {
      expect(tracker.isUsable(0)).toBe(true);
    });

    it("returns 0 consecutive failures for new accounts", () => {
      expect(tracker.getConsecutiveFailures(0)).toBe(0);
    });
  });

  describe("success recording", () => {
    it("increases score by successReward (+1)", () => {
      tracker.recordSuccess(0);
      expect(tracker.getScore(0)).toBe(71);
    });

    it("resets consecutive failures on success", () => {
      tracker.recordRateLimit(0);
      tracker.recordRateLimit(0);
      expect(tracker.getConsecutiveFailures(0)).toBe(2);

      tracker.recordSuccess(0);
      expect(tracker.getConsecutiveFailures(0)).toBe(0);
    });

    it("caps score at maxScore (100)", () => {
      for (let i = 0; i < 50; i++) {
        tracker.recordSuccess(0);
      }
      expect(tracker.getScore(0)).toBe(100);
    });
  });

  describe("rate limit recording", () => {
    it("decreases score by rateLimitPenalty (-10)", () => {
      tracker.recordRateLimit(0);
      expect(tracker.getScore(0)).toBe(60);
    });

    it("increments consecutive failures", () => {
      tracker.recordRateLimit(0);
      expect(tracker.getConsecutiveFailures(0)).toBe(1);

      tracker.recordRateLimit(0);
      expect(tracker.getConsecutiveFailures(0)).toBe(2);
    });

    it("floors score at 0", () => {
      for (let i = 0; i < 10; i++) {
        tracker.recordRateLimit(0);
      }
      expect(tracker.getScore(0)).toBe(0);
    });
  });

  describe("failure recording", () => {
    it("decreases score by failurePenalty (-20)", () => {
      tracker.recordFailure(0);
      expect(tracker.getScore(0)).toBe(50);
    });

    it("increments consecutive failures", () => {
      tracker.recordFailure(0);
      expect(tracker.getConsecutiveFailures(0)).toBe(1);
    });
  });

  describe("usability threshold", () => {
    it("marks account usable when score >= minUsable (50)", () => {
      tracker.recordRateLimit(0); // 70 -> 60
      tracker.recordRateLimit(0); // 60 -> 50
      expect(tracker.isUsable(0)).toBe(true);
    });

    it("marks account unusable when score < minUsable (50)", () => {
      tracker.recordRateLimit(0); // 70 -> 60
      tracker.recordRateLimit(0); // 60 -> 50
      tracker.recordRateLimit(0); // 50 -> 40
      expect(tracker.isUsable(0)).toBe(false);
    });
  });

  describe("passive recovery", () => {
    it("recovers 2 points per hour", () => {
      tracker.recordRateLimit(0); // 70 -> 60

      const scores = (tracker as unknown as { scores: Map<number, unknown> })
        .scores;
      const state = scores.get(0) as { lastUpdated: number };
      state.lastUpdated = Date.now() - 60 * 60 * 1000; // 1 hour ago

      expect(tracker.getScore(0)).toBe(62); // 60 + 2
    });

    it("does not exceed maxScore during recovery", () => {
      tracker.recordSuccess(0); // 70 -> 71

      const scores = (tracker as unknown as { scores: Map<number, unknown> })
        .scores;
      const state = scores.get(0) as { lastUpdated: number };
      state.lastUpdated = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

      expect(tracker.getScore(0)).toBe(100);
    });
  });

  describe("reset", () => {
    it("clears state for account", () => {
      tracker.recordSuccess(0);
      expect(tracker.getScore(0)).toBe(71);

      tracker.reset(0);
      expect(tracker.getScore(0)).toBe(70);
    });
  });

  describe("persistence", () => {
    it("exports state to JSON", () => {
      tracker.recordSuccess(0);
      tracker.recordRateLimit(1);

      const json = tracker.toJSON();
      expect(json["0"]).toBeDefined();
      expect(json["0"].score).toBe(71);
      expect(json["1"]).toBeDefined();
      expect(json["1"].score).toBe(60);
    });

    it("loads state from JSON", () => {
      const data = {
        "0": {
          score: 85,
          lastUpdated: Date.now(),
          lastSuccess: Date.now(),
          consecutiveFailures: 0,
        },
        "2": {
          score: 45,
          lastUpdated: Date.now(),
          lastSuccess: 0,
          consecutiveFailures: 3,
        },
      };

      tracker.loadFromJSON(data);
      expect(tracker.getScore(0)).toBe(85);
      expect(tracker.getScore(2)).toBe(45);
      expect(tracker.getConsecutiveFailures(2)).toBe(3);
    });

    it("preserves scores across load/save cycle", () => {
      tracker.recordSuccess(0);
      tracker.recordRateLimit(1);

      const json = tracker.toJSON();
      const newTracker = new HealthScoreTracker();
      newTracker.loadFromJSON(json);

      expect(newTracker.getScore(0)).toBe(tracker.getScore(0));
      expect(newTracker.getScore(1)).toBe(tracker.getScore(1));
    });
  });

  describe("custom config", () => {
    it("uses custom initial score", () => {
      const custom = new HealthScoreTracker({ initial: 50 });
      expect(custom.getScore(0)).toBe(50);
    });

    it("uses custom penalties", () => {
      const custom = new HealthScoreTracker({
        initial: 100,
        rateLimitPenalty: -25,
      });
      custom.recordRateLimit(0);
      expect(custom.getScore(0)).toBe(75);
    });

    it("uses custom success reward", () => {
      const custom = new HealthScoreTracker({
        initial: 50,
        successReward: 5,
      });
      custom.recordSuccess(0);
      expect(custom.getScore(0)).toBe(55);
    });

    it("uses custom minUsable threshold", () => {
      const custom = new HealthScoreTracker({
        initial: 50,
        minUsable: 60,
      });
      expect(custom.isUsable(0)).toBe(false);
    });
  });

  describe("getSnapshot", () => {
    it("returns empty map for no tracked accounts", () => {
      const snapshot = tracker.getSnapshot();
      expect(snapshot.size).toBe(0);
    });

    it("returns scores for tracked accounts", () => {
      tracker.recordSuccess(0);
      tracker.recordRateLimit(1);

      const snapshot = tracker.getSnapshot();
      expect(snapshot.size).toBe(2);
      expect(snapshot.get(0)?.score).toBe(71);
      expect(snapshot.get(1)?.score).toBe(60);
    });
  });
});

describe("TokenBucketTracker", () => {
  let tracker: TokenBucketTracker;

  beforeEach(() => {
    tracker = new TokenBucketTracker();
  });

  describe("initial state", () => {
    it("returns initial tokens (50) for new accounts", () => {
      expectTokensClose(tracker.getTokens(0), 50);
    });

    it("has tokens available for new accounts", () => {
      expect(tracker.hasTokens(0)).toBe(true);
    });

    it("returns max tokens from config", () => {
      expect(tracker.getMaxTokens()).toBe(50);
    });
  });

  describe("consumption", () => {
    it("consumes 1 token by default", () => {
      tracker.consume(0);
      expectTokensClose(tracker.getTokens(0), 49);
    });

    it("consumes specified amount", () => {
      tracker.consume(0, 5);
      expectTokensClose(tracker.getTokens(0), 45, 0);
    });

    it("returns true on successful consumption", () => {
      expect(tracker.consume(0)).toBe(true);
    });

    it("returns false when insufficient tokens", () => {
      for (let i = 0; i < 50; i++) {
        tracker.consume(0);
      }
      expect(tracker.consume(0)).toBe(false);
    });

    it("does not consume when insufficient", () => {
      for (let i = 0; i < 50; i++) {
        tracker.consume(0);
      }
      const before = tracker.getTokens(0);
      tracker.consume(0);
      expectTokensClose(tracker.getTokens(0), before);
    });
  });

  describe("hasTokens", () => {
    it("returns true when tokens >= cost", () => {
      expect(tracker.hasTokens(0, 50)).toBe(true);
    });

    it("returns false when tokens < cost", () => {
      expect(tracker.hasTokens(0, 51)).toBe(false);
    });

    it("defaults to cost of 1", () => {
      for (let i = 0; i < 50; i++) {
        tracker.consume(0);
      }
      expect(tracker.hasTokens(0)).toBe(false);
    });
  });

  describe("refund", () => {
    it("refunds 1 token by default", () => {
      tracker.consume(0);
      tracker.refund(0);
      expectTokensClose(tracker.getTokens(0), 50);
    });

    it("refunds specified amount", () => {
      tracker.consume(0, 10);
      tracker.refund(0, 5);
      expectTokensClose(tracker.getTokens(0), 45);
    });

    it("does not exceed maxTokens on refund", () => {
      tracker.refund(0, 100);
      expectTokensClose(tracker.getTokens(0), 50);
    });
  });

  describe("regeneration", () => {
    it("regenerates 6 tokens per minute", () => {
      tracker.consume(0, 10); // 50 -> 40

      const buckets = (tracker as unknown as { buckets: Map<number, unknown> })
        .buckets;
      const state = buckets.get(0) as { lastUpdated: number };
      state.lastUpdated = Date.now() - 60 * 1000; // 1 minute ago

      expectTokensClose(tracker.getTokens(0), 46); // 40 + 6
    });

    it("does not exceed maxTokens during regeneration", () => {
      tracker.consume(0, 1); // 50 -> 49

      const buckets = (tracker as unknown as { buckets: Map<number, unknown> })
        .buckets;
      const state = buckets.get(0) as { lastUpdated: number };
      state.lastUpdated = Date.now() - 10 * 60 * 1000; // 10 minutes ago

      expectTokensClose(tracker.getTokens(0), 50);
    });
  });

  describe("persistence", () => {
    it("exports state to JSON", () => {
      tracker.consume(0, 10);
      tracker.consume(1, 20);

      const json = tracker.toJSON();
      expect(json["0"]).toBeDefined();
      expect(json["0"].tokens).toBe(40);
      expect(json["1"]).toBeDefined();
      expect(json["1"].tokens).toBe(30);
    });

    it("loads state from JSON", () => {
      const data = {
        "0": { tokens: 25, lastUpdated: Date.now() },
        "2": { tokens: 10, lastUpdated: Date.now() },
      };

      tracker.loadFromJSON(data);
      expectTokensClose(tracker.getTokens(0), 25);
      expectTokensClose(tracker.getTokens(2), 10);
    });

    it("preserves state across load/save cycle", () => {
      tracker.consume(0, 15);
      tracker.consume(1, 30);

      const json = tracker.toJSON();
      const newTracker = new TokenBucketTracker();
      newTracker.loadFromJSON(json);

      expectTokensClose(newTracker.getTokens(0), tracker.getTokens(0));
      expectTokensClose(newTracker.getTokens(1), tracker.getTokens(1));
    });
  });

  describe("custom config", () => {
    it("uses custom maxTokens", () => {
      const custom = new TokenBucketTracker({ maxTokens: 100 });
      expect(custom.getMaxTokens()).toBe(100);
    });

    it("uses custom initialTokens", () => {
      const custom = new TokenBucketTracker({ initialTokens: 25 });
      expectTokensClose(custom.getTokens(0), 25);
    });

    it("uses custom regeneration rate", () => {
      const custom = new TokenBucketTracker({
        regenerationRatePerMinute: 12,
        initialTokens: 40,
        maxTokens: 50,
      });
      custom.consume(0, 20); // 40 -> 20

      const buckets = (custom as unknown as { buckets: Map<number, unknown> })
        .buckets;
      const state = buckets.get(0) as { lastUpdated: number };
      state.lastUpdated = Date.now() - 60 * 1000; // 1 minute ago

      expectTokensClose(custom.getTokens(0), 32); // 20 + 12
    });
  });
});

describe("calculateHybridScore", () => {
  const now = Date.now();

  it("calculates health component (score × 2)", () => {
    const account: AccountWithMetrics = {
      index: 0,
      lastUsed: now,
      healthScore: 80,
      tokens: 0,
      isRateLimited: false,
    };

    const result = calculateHybridScore(account, 50);
    expect(result.breakdown.health).toBe(160); // 80 × 2
  });

  it("calculates token component (percentage × 100 × 5)", () => {
    const account: AccountWithMetrics = {
      index: 0,
      lastUsed: now,
      healthScore: 0,
      tokens: 25, // 50% of max
      isRateLimited: false,
    };

    const result = calculateHybridScore(account, 50);
    expect(result.breakdown.tokens).toBe(250); // (25/50) × 100 × 5
  });

  it("calculates freshness component (seconds × 0.1)", () => {
    const tenMinutesAgo = now - 1000 * 60 * 10;
    const account: AccountWithMetrics = {
      index: 0,
      lastUsed: tenMinutesAgo,
      healthScore: 0,
      tokens: 0,
      isRateLimited: false,
    };

    const result = calculateHybridScore(account, 50);
    expect(result.breakdown.freshness).toBeCloseTo(60, 0); // ~600s × 0.1
  });

  it("caps freshness at 1 hour (360 points max)", () => {
    const dayAgo = now - 1000 * 60 * 60 * 24;
    const account: AccountWithMetrics = {
      index: 0,
      lastUsed: dayAgo,
      healthScore: 0,
      tokens: 0,
      isRateLimited: false,
    };

    const result = calculateHybridScore(account, 50);
    expect(result.breakdown.freshness).toBe(360);
  });

  it("combines all components into total score", () => {
    const account: AccountWithMetrics = {
      index: 0,
      lastUsed: now,
      healthScore: 50,
      tokens: 50,
      isRateLimited: false,
    };

    const result = calculateHybridScore(account, 50);
    // health: 50 × 2 = 100
    // tokens: (50/50) × 100 × 5 = 500
    // freshness: ~0
    expect(result.score).toBeCloseTo(600, 0);
  });

  it("returns non-negative score", () => {
    const account: AccountWithMetrics = {
      index: 0,
      lastUsed: now + 10000, // Future (negative freshness)
      healthScore: 0,
      tokens: 0,
      isRateLimited: false,
    };

    const result = calculateHybridScore(account, 50);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe("selectHybridAccount", () => {
  const now = Date.now();

  function createAccount(
    overrides: Partial<AccountWithMetrics>,
  ): AccountWithMetrics {
    return {
      index: 0,
      lastUsed: now - 60000, // 1 minute ago
      healthScore: 70,
      tokens: 50,
      isRateLimited: false,
      ...overrides,
    };
  }

  it("selects account with highest combined score", () => {
    const accounts = [
      createAccount({ index: 0, healthScore: 60, tokens: 30 }),
      createAccount({ index: 1, healthScore: 90, tokens: 50 }), // Highest
      createAccount({ index: 2, healthScore: 70, tokens: 40 }),
    ];

    const result = selectHybridAccount(accounts);
    expect(result?.index).toBe(1);
  });

  it("weighs tokens heavily (5x)", () => {
    const accounts = [
      createAccount({ index: 0, healthScore: 100, tokens: 10 }), // health=200, tokens=100
      createAccount({ index: 1, healthScore: 70, tokens: 50 }), // health=140, tokens=500
    ];

    const result = selectHybridAccount(accounts);
    expect(result?.index).toBe(1); // More tokens wins
  });

  it("considers freshness (LRU)", () => {
    const accounts = [
      createAccount({
        index: 0,
        healthScore: 70,
        tokens: 50,
        lastUsed: now - 1000,
      }), // 1s ago
      createAccount({
        index: 1,
        healthScore: 70,
        tokens: 50,
        lastUsed: now - 3600000,
      }), // 1 hour ago
    ];

    const result = selectHybridAccount(accounts);
    expect(result?.index).toBe(1); // Fresher (less recently used) wins
  });

  it("skips rate-limited accounts", () => {
    const accounts = [
      createAccount({
        index: 0,
        healthScore: 100,
        tokens: 50,
        isRateLimited: true,
      }),
      createAccount({
        index: 1,
        healthScore: 50,
        tokens: 20,
        isRateLimited: false,
      }),
    ];

    const result = selectHybridAccount(accounts);
    expect(result?.index).toBe(1);
  });

  it("skips accounts below health threshold", () => {
    const accounts = [
      createAccount({ index: 0, healthScore: 40, tokens: 50 }), // Below 50
      createAccount({ index: 1, healthScore: 55, tokens: 20 }),
    ];

    const result = selectHybridAccount(accounts, 50);
    expect(result?.index).toBe(1);
  });

  it("skips accounts with no tokens", () => {
    const accounts = [
      createAccount({ index: 0, healthScore: 100, tokens: 0 }),
      createAccount({ index: 1, healthScore: 60, tokens: 10 }),
    ];

    const result = selectHybridAccount(accounts);
    expect(result?.index).toBe(1);
  });

  it("returns null when all accounts rate-limited", () => {
    const accounts = [
      createAccount({ index: 0, isRateLimited: true }),
      createAccount({ index: 1, isRateLimited: true }),
    ];

    const result = selectHybridAccount(accounts);
    expect(result).toBeNull();
  });

  it("falls back to best available when all accounts below health threshold", () => {
    const accounts = [
      createAccount({ index: 0, healthScore: 30 }),
      createAccount({ index: 1, healthScore: 40 }),
    ];

    const result = selectHybridAccount(accounts, 50);
    expect(result).not.toBeNull();
    expect(result?.index).toBe(1);
  });

  it("returns null for empty account list", () => {
    const result = selectHybridAccount([]);
    expect(result).toBeNull();
  });

  it("provides score breakdown", () => {
    const accounts = [createAccount({ index: 0 })];
    const result = selectHybridAccount(accounts);

    expect(result?.breakdown).toBeDefined();
    expect(result?.breakdown.health).toBeGreaterThan(0);
    expect(result?.breakdown.tokens).toBeGreaterThan(0);
    expect(result?.breakdown.freshness).toBeGreaterThanOrEqual(0);
  });

  it("uses custom minHealthScore", () => {
    const accounts = [
      createAccount({ index: 0, healthScore: 60 }),
      createAccount({ index: 1, healthScore: 80 }),
    ];

    const resultWith70 = selectHybridAccount(accounts, 70);
    expect(resultWith70?.index).toBe(1); // Only account 1 meets threshold

    const resultWith50 = selectHybridAccount(accounts, 50);
    expect(resultWith50?.index).toBe(1); // Both meet, account 1 has higher score
  });

  it("uses custom maxTokens for percentage calculation", () => {
    const accounts = [
      createAccount({ index: 0, healthScore: 70, tokens: 25 }),
      createAccount({ index: 1, healthScore: 70, tokens: 50 }),
    ];

    // With maxTokens=50: account 0 has 50% tokens, account 1 has 100%
    const result50 = selectHybridAccount(accounts, 50, 50);
    expect(result50?.index).toBe(1);

    // With maxTokens=100: account 0 has 25% tokens, account 1 has 50%
    const result100 = selectHybridAccount(accounts, 50, 100);
    expect(result100?.index).toBe(1);
  });
});

describe("default configs", () => {
  it("exports DEFAULT_HEALTH_SCORE_CONFIG with expected values", () => {
    expect(DEFAULT_HEALTH_SCORE_CONFIG.initial).toBe(70);
    expect(DEFAULT_HEALTH_SCORE_CONFIG.successReward).toBe(1);
    expect(DEFAULT_HEALTH_SCORE_CONFIG.rateLimitPenalty).toBe(-10);
    expect(DEFAULT_HEALTH_SCORE_CONFIG.failurePenalty).toBe(-20);
    expect(DEFAULT_HEALTH_SCORE_CONFIG.recoveryRatePerHour).toBe(2);
    expect(DEFAULT_HEALTH_SCORE_CONFIG.minUsable).toBe(50);
    expect(DEFAULT_HEALTH_SCORE_CONFIG.maxScore).toBe(100);
  });

  it("exports DEFAULT_TOKEN_BUCKET_CONFIG with expected values", () => {
    expect(DEFAULT_TOKEN_BUCKET_CONFIG.maxTokens).toBe(50);
    expect(DEFAULT_TOKEN_BUCKET_CONFIG.regenerationRatePerMinute).toBe(6);
    expect(DEFAULT_TOKEN_BUCKET_CONFIG.initialTokens).toBe(50);
  });
});

describe("resetTrackers", () => {
  afterEach(() => {
    resetTrackers();
  });

  it("resets global trackers without error", () => {
    expect(() => resetTrackers()).not.toThrow();
  });
});
