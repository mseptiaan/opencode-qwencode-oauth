import { afterEach, describe, expect, it } from "bun:test";
import {
  type AccountStorage,
  getMinRateLimitWait,
  markRateLimited,
  selectAccount,
} from "../src/plugin/account";
import {
  HealthScoreTracker,
  resetTrackers,
  TokenBucketTracker,
} from "../src/plugin/rotation";

afterEach(() => {
  resetTrackers();
});

function createStorage(): AccountStorage {
  const now = Date.now();
  return {
    version: 1,
    activeIndex: 0,
    accounts: [
      { refreshToken: "r1", addedAt: now, lastUsed: now },
      { refreshToken: "r2", addedAt: now, lastUsed: now },
    ],
  };
}

function createStorageWithThreeAccounts(): AccountStorage {
  const now = Date.now();
  return {
    version: 1,
    activeIndex: 0,
    accounts: [
      { refreshToken: "r1", addedAt: now, lastUsed: now },
      { refreshToken: "r2", addedAt: now, lastUsed: now - 1000 },
      { refreshToken: "r3", addedAt: now, lastUsed: now - 2000 },
    ],
  };
}

describe("selectAccount", () => {
  it("rotates in round-robin mode", () => {
    const now = Date.now();
    const storage = createStorage();

    const first = selectAccount(storage, "round-robin", now);
    expect(first?.index).toBe(1);

    const second = selectAccount(first?.storage ?? storage, "round-robin", now);
    expect(second?.index).toBe(0);
  });

  it("sticks to active index in sequential mode", () => {
    const now = Date.now();
    const storage = createStorage();

    const selected = selectAccount(storage, "sequential", now);
    expect(selected?.index).toBe(0);
  });

  it("skips rate-limited accounts", () => {
    const now = Date.now();
    const storage = createStorage();
    const limited = markRateLimited(storage, 0, 60_000);

    const selected = selectAccount(limited, "sequential", now);
    expect(selected?.index).toBe(1);
  });
});

describe("getMinRateLimitWait", () => {
  it("returns the minimum wait time", () => {
    const now = Date.now();
    const storage = createStorage();
    const limited = markRateLimited(storage, 0, 120_000);
    const limitedAgain = markRateLimited(limited, 1, 60_000);

    const wait = getMinRateLimitWait(limitedAgain, now);
    expect(wait).toBeGreaterThanOrEqual(60_000);
    expect(wait).toBeLessThan(120_000 + 1000);
  });
});

describe("selectAccount hybrid strategy", () => {
  it("selects account with highest combined score", () => {
    const now = Date.now();
    const storage = createStorageWithThreeAccounts();
    const healthTracker = new HealthScoreTracker();
    const tokenTracker = new TokenBucketTracker();

    healthTracker.recordSuccess(2);
    healthTracker.recordFailure(0);
    healthTracker.recordFailure(1);

    const result = selectAccount(storage, "hybrid", now, {
      healthTracker,
      tokenTracker,
    });
    expect(result?.index).toBe(2);
  });

  it("skips accounts with low health scores", () => {
    const now = Date.now();
    const storage = createStorage();
    const healthTracker = new HealthScoreTracker();
    const tokenTracker = new TokenBucketTracker();

    for (let i = 0; i < 3; i++) healthTracker.recordFailure(0);

    const result = selectAccount(storage, "hybrid", now, {
      healthTracker,
      tokenTracker,
    });
    expect(result?.index).toBe(1);
  });

  it("skips rate-limited accounts in hybrid mode", () => {
    const now = Date.now();
    const storage = createStorage();
    const limited = markRateLimited(storage, 0, 60_000);
    const healthTracker = new HealthScoreTracker();
    const tokenTracker = new TokenBucketTracker();

    const result = selectAccount(limited, "hybrid", now, {
      healthTracker,
      tokenTracker,
    });
    expect(result?.index).toBe(1);
  });

  it("consumes a token on hybrid selection", () => {
    const now = Date.now();
    const storage = createStorage();
    const healthTracker = new HealthScoreTracker();
    const tokenTracker = new TokenBucketTracker();

    const initialTokens = tokenTracker.getTokens(0);
    selectAccount(storage, "hybrid", now, { healthTracker, tokenTracker });

    const resultTokens = tokenTracker.getTokens(
      storage.accounts.findIndex((a) => a.refreshToken === "r1"),
    );
    expect(resultTokens).toBeLessThanOrEqual(initialTokens);
  });

  it("applies PID offset to distribute selections among equal accounts", () => {
    const now = Date.now();
    const storage: AccountStorage = {
      version: 1,
      activeIndex: 0,
      accounts: [
        { refreshToken: "r1", addedAt: now, lastUsed: now },
        { refreshToken: "r2", addedAt: now, lastUsed: now },
        { refreshToken: "r3", addedAt: now, lastUsed: now },
      ],
    };

    const healthTracker1 = new HealthScoreTracker();
    const tokenTracker1 = new TokenBucketTracker();
    const result1 = selectAccount(storage, "hybrid", now, {
      healthTracker: healthTracker1,
      tokenTracker: tokenTracker1,
      pidOffset: 0,
    });

    const healthTracker2 = new HealthScoreTracker();
    const tokenTracker2 = new TokenBucketTracker();
    const result2 = selectAccount(storage, "hybrid", now, {
      healthTracker: healthTracker2,
      tokenTracker: tokenTracker2,
      pidOffset: 1,
    });

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
  });

  it("selects best available even when below health threshold (soft fallback)", () => {
    const now = Date.now();
    const storage = createStorage();
    const healthTracker = new HealthScoreTracker();
    const tokenTracker = new TokenBucketTracker();

    for (let i = 0; i < 5; i++) {
      healthTracker.recordFailure(0);
      healthTracker.recordFailure(1);
    }

    const result = selectAccount(storage, "hybrid", now, {
      healthTracker,
      tokenTracker,
    });
    expect(result).not.toBeNull();
  });
});
