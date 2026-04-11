import type { TokenBucketConfig, TokenBucketState } from "./types";
import { DEFAULT_TOKEN_BUCKET_CONFIG } from "./types";

export class TokenBucketTracker {
  private readonly buckets = new Map<number, TokenBucketState>();
  readonly config: TokenBucketConfig;

  constructor(config: Partial<TokenBucketConfig> = {}) {
    this.config = { ...DEFAULT_TOKEN_BUCKET_CONFIG, ...config };
  }

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

  hasTokens(accountIndex: number, cost = 1): boolean {
    return this.getTokens(accountIndex) >= cost;
  }

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

  refund(accountIndex: number, amount = 1): void {
    const current = this.getTokens(accountIndex);
    this.buckets.set(accountIndex, {
      tokens: Math.min(this.config.maxTokens, current + amount),
      lastUpdated: Date.now(),
    });
  }

  removeAccountAt(removedIndex: number): void {
    const next = new Map<number, TokenBucketState>();
    for (const [idx, state] of this.buckets) {
      if (idx === removedIndex) continue;
      const newIdx = idx > removedIndex ? idx - 1 : idx;
      next.set(newIdx, state);
    }
    this.buckets.clear();
    for (const [idx, state] of next) {
      this.buckets.set(idx, state);
    }
  }

  getMaxTokens(): number {
    return this.config.maxTokens;
  }

  toJSON(): Record<string, TokenBucketState> {
    const result: Record<string, TokenBucketState> = {};
    for (const [index, state] of this.buckets) {
      result[String(index)] = { ...state };
    }
    return result;
  }

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

let globalTokenTracker: TokenBucketTracker | null = null;

export function getTokenTracker(): TokenBucketTracker {
  if (!globalTokenTracker) {
    globalTokenTracker = new TokenBucketTracker();
  }
  return globalTokenTracker;
}

export function initTokenTracker(
  config?: Partial<TokenBucketConfig>,
): TokenBucketTracker {
  globalTokenTracker = new TokenBucketTracker(config);
  return globalTokenTracker;
}

export function resetTokenTracker(): void {
  globalTokenTracker = null;
}
