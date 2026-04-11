import type { HealthScoreConfig, HealthScoreState } from "./types";
import { DEFAULT_HEALTH_SCORE_CONFIG } from "./types";

export class HealthScoreTracker {
  private readonly scores = new Map<number, HealthScoreState>();
  readonly config: HealthScoreConfig;

  constructor(config: Partial<HealthScoreConfig> = {}) {
    this.config = { ...DEFAULT_HEALTH_SCORE_CONFIG, ...config };
  }

  getScore(accountIndex: number): number {
    const state = this.scores.get(accountIndex);
    if (!state) {
      return this.config.initial;
    }

    const now = Date.now();
    const hoursSinceUpdate = (now - state.lastUpdated) / (1000 * 60 * 60);
    const recoveredPoints = Math.floor(
      hoursSinceUpdate * this.config.recoveryRatePerHour,
    );

    return Math.min(this.config.maxScore, state.score + recoveredPoints);
  }

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

  isUsable(accountIndex: number): boolean {
    return this.getScore(accountIndex) >= this.config.minUsable;
  }

  getConsecutiveFailures(accountIndex: number): number {
    return this.scores.get(accountIndex)?.consecutiveFailures ?? 0;
  }

  reset(accountIndex: number): void {
    this.scores.delete(accountIndex);
  }

  removeAccountAt(removedIndex: number): void {
    const next = new Map<number, HealthScoreState>();
    for (const [idx, state] of this.scores) {
      if (idx === removedIndex) continue;
      const newIdx = idx > removedIndex ? idx - 1 : idx;
      next.set(newIdx, state);
    }
    this.scores.clear();
    for (const [idx, state] of next) {
      this.scores.set(idx, state);
    }
  }

  toJSON(): Record<string, HealthScoreState> {
    const result: Record<string, HealthScoreState> = {};
    for (const [index, state] of this.scores) {
      result[String(index)] = { ...state };
    }
    return result;
  }

  loadFromJSON(data: Record<string, HealthScoreState>): void {
    this.scores.clear();
    for (const [key, state] of Object.entries(data)) {
      const index = Number.parseInt(key, 10);
      if (!Number.isNaN(index) && state) {
        this.scores.set(index, { ...state });
      }
    }
  }

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

let globalHealthTracker: HealthScoreTracker | null = null;

export function getHealthTracker(): HealthScoreTracker {
  if (!globalHealthTracker) {
    globalHealthTracker = new HealthScoreTracker();
  }
  return globalHealthTracker;
}

export function initHealthTracker(
  config?: Partial<HealthScoreConfig>,
): HealthScoreTracker {
  globalHealthTracker = new HealthScoreTracker(config);
  return globalHealthTracker;
}

export function resetHealthTracker(): void {
  globalHealthTracker = null;
}
