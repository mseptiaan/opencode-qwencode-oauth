import type {
  AccountWithMetrics,
  AdaptiveConfig,
  AdaptiveSelectionResult,
  AdaptiveState,
} from "./types";
import { DEFAULT_ADAPTIVE_CONFIG } from "./types";

export type { AdaptiveSelectionResult } from "./types";

export class AdaptiveTracker {
  private readonly states = new Map<number, AdaptiveState>();
  readonly config: AdaptiveConfig;

  constructor(config: Partial<AdaptiveConfig> = {}) {
    this.config = { ...DEFAULT_ADAPTIVE_CONFIG, ...config };
  }

  getWeight(accountIndex: number): number {
    const state = this.states.get(accountIndex);
    return state?.weight ?? 1.0;
  }

  adjustWeight(accountIndex: number, delta: number): void {
    const current = this.getWeight(accountIndex);
    const adjusted = Math.max(
      this.config.minWeight,
      Math.min(this.config.maxWeight, current + delta),
    );
    this.states.set(accountIndex, {
      ...(this.states.get(accountIndex) ?? {
        weight: 1.0,
        rateLimitTimestamps: [],
        lastAdjustment: Date.now(),
      }),
      weight: adjusted,
      lastAdjustment: Date.now(),
    });
  }

  getRateLimitCount(accountIndex: number, windowMs?: number): number {
    const state = this.states.get(accountIndex);
    if (!state) return 0;

    const window = windowMs ?? this.config.cooldownPeriodMs;
    const cutoff = Date.now() - window;
    return state.rateLimitTimestamps.filter((ts) => ts > cutoff).length;
  }

  calculateRateLimitFrequency(accountIndex: number): number {
    const count = this.getRateLimitCount(accountIndex);
    if (count === 0) return 0;
    return count / this.config.historyWindow;
  }

  recordRateLimit(accountIndex: number): void {
    const state = this.states.get(accountIndex) ?? {
      weight: 1.0,
      rateLimitTimestamps: [],
      lastAdjustment: Date.now(),
    };

    state.rateLimitTimestamps.push(Date.now());

    if (state.rateLimitTimestamps.length > this.config.historyWindow) {
      state.rateLimitTimestamps.shift();
    }

    const frequency = this.calculateRateLimitFrequency(accountIndex);
    const penalty = this.config.learningRate * (1 + frequency);
    this.adjustWeight(accountIndex, -penalty);

    this.states.set(accountIndex, {
      ...state,
      weight: this.getWeight(accountIndex),
      lastAdjustment: Date.now(),
    });
  }

  recordSuccess(accountIndex: number): void {
    const frequency = this.calculateRateLimitFrequency(accountIndex);
    if (frequency === 0) {
      this.adjustWeight(accountIndex, this.config.learningRate);
    }
  }

  recordFailure(accountIndex: number): void {
    this.adjustWeight(accountIndex, -this.config.learningRate * 0.5);
  }

  selectAccount(
    accounts: AccountWithMetrics[],
    minHealthScore: number,
    maxTokens: number,
  ): AdaptiveSelectionResult | null {
    const nonRateLimited = accounts.filter((acc) => !acc.isRateLimited);
    if (nonRateLimited.length === 0) return null;

    const idealCandidates = nonRateLimited.filter(
      (acc) => acc.healthScore >= minHealthScore && acc.tokens >= 1,
    );
    const candidates =
      idealCandidates.length > 0 ? idealCandidates : nonRateLimited;

    const scored = candidates.map((acc) => {
      const weight = this.getWeight(acc.index);
      const frequency = this.calculateRateLimitFrequency(acc.index);
      const healthComponent = acc.healthScore * weight;
      const tokenComponent = (acc.tokens / maxTokens) * 50 * weight;
      const freshnessComponent =
        Math.min((Date.now() - acc.lastUsed) / 1000, 3600) * 0.1;
      const frequencyPenalty = frequency * 20;

      const score = Math.max(
        0,
        healthComponent +
          tokenComponent +
          freshnessComponent -
          frequencyPenalty,
      );

      return {
        index: acc.index,
        weight,
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0] ?? null;
  }

  reset(accountIndex: number): void {
    this.states.delete(accountIndex);
  }

  removeAccountAt(removedIndex: number): void {
    const next = new Map<number, AdaptiveState>();
    for (const [idx, state] of this.states) {
      if (idx === removedIndex) continue;
      const newIdx = idx > removedIndex ? idx - 1 : idx;
      next.set(newIdx, state);
    }
    this.states.clear();
    for (const [idx, state] of next) {
      this.states.set(idx, state);
    }
  }

  toJSON(): Record<string, AdaptiveState> {
    const result: Record<string, AdaptiveState> = {};
    for (const [index, state] of this.states) {
      result[String(index)] = { ...state };
    }
    return result;
  }

  loadFromJSON(data: Record<string, AdaptiveState>): void {
    this.states.clear();
    for (const [key, state] of Object.entries(data)) {
      const index = Number.parseInt(key, 10);
      if (!Number.isNaN(index) && state) {
        this.states.set(index, { ...state });
      }
    }
  }

  getSnapshot(): Map<number, { weight: number; rateLimitCount: number }> {
    const result = new Map<
      number,
      { weight: number; rateLimitCount: number }
    >();
    for (const [index] of this.states) {
      result.set(index, {
        weight: this.getWeight(index),
        rateLimitCount: this.getRateLimitCount(index),
      });
    }
    return result;
  }
}

let globalAdaptiveTracker: AdaptiveTracker | null = null;

export function getAdaptiveTracker(): AdaptiveTracker {
  if (!globalAdaptiveTracker) {
    globalAdaptiveTracker = new AdaptiveTracker();
  }
  return globalAdaptiveTracker;
}

export function initAdaptiveTracker(
  config?: Partial<AdaptiveConfig>,
): AdaptiveTracker {
  globalAdaptiveTracker = new AdaptiveTracker(config);
  return globalAdaptiveTracker;
}

export function resetAdaptiveTracker(): void {
  globalAdaptiveTracker = null;
}
