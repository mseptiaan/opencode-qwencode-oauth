import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isValidOAuthRefreshToken } from "./auth";
import type { RotationStrategy } from "./config/schema";
import {
  type AccountWithMetrics,
  type AdaptiveTracker,
  getAdaptiveTracker,
  getHealthTracker,
  getTokenTracker,
  type HealthScoreState,
  type HealthScoreTracker,
  selectHybridAccount,
  type TokenBucketState,
  type TokenBucketTracker,
} from "./rotation";

/**
 * Acquire an exclusive file lock using atomic mkdir (same technique as
 * proper-lockfile). Returns a release function.
 */
async function acquireFileLock(
  filePath: string,
  opts: {
    stale: number;
    retries: {
      retries: number;
      minTimeout: number;
      maxTimeout: number;
      factor: number;
    };
  },
): Promise<() => Promise<void>> {
  const lockDir = `${filePath}.lock`;
  const pidFile = join(lockDir, "pid");
  const { stale, retries: r } = opts;
  let attempt = 0;
  let delay = r.minTimeout;

  for (;;) {
    try {
      await fs.mkdir(lockDir);
      await fs
        .writeFile(
          pidFile,
          JSON.stringify({ pid: process.pid, time: Date.now() }),
          "utf-8",
        )
        .catch(() => undefined);
      return async () => {
        await fs
          .rm(lockDir, { recursive: true, force: true })
          .catch(() => undefined);
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;

      // Check staleness using directory mtime (available immediately after mkdir)
      // This avoids race condition where pid file hasn't been written yet
      try {
        const stat = await fs.stat(lockDir);
        const lockAge = Date.now() - stat.mtimeMs;
        if (lockAge > stale) {
          await fs
            .rm(lockDir, { recursive: true, force: true })
            .catch(() => undefined);
          continue;
        }
      } catch {
        await fs
          .rm(lockDir, { recursive: true, force: true })
          .catch(() => undefined);
        continue;
      }

      if (attempt >= r.retries) {
        throw new Error(
          `[qwen-oauth] Could not acquire lock on ${filePath} after ${r.retries} attempts`,
        );
      }
      await new Promise<void>((res) => setTimeout(res, delay));
      delay = Math.min(delay * r.factor, r.maxTimeout);
      attempt++;
    }
  }
}

export type { RotationStrategy } from "./config/schema";

/**
 * Options for selectAccount when using hybrid or adaptive strategy.
 */
export interface SelectAccountOptions {
  /** Health score tracker for hybrid/adaptive selection */
  healthTracker?: HealthScoreTracker;
  /** Token bucket tracker for hybrid/adaptive selection */
  tokenTracker?: TokenBucketTracker;
  /** Adaptive tracker for adaptive strategy */
  adaptiveTracker?: AdaptiveTracker;
  /** PID offset for distributing sessions across accounts */
  pidOffset?: number;
}

export interface AccountHealth {
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastSuccess?: number;
  lastFailure?: number;
}

export interface QwenAccount {
  refreshToken: string;
  accessToken?: string;
  expires?: number;
  resourceUrl?: string;
  addedAt: number;
  lastUsed: number;
  rateLimitResetAt?: number;
  /**
   * When true the refresh token has been rejected (e.g. invalid_grant).
   * The account is excluded from rotation until the user re-authenticates.
   */
  requiresReauth?: boolean;
  health?: AccountHealth;
}

export interface AccountStorage {
  version: 1;
  accounts: QwenAccount[];
  activeIndex: number;
}

const STORAGE_VERSION: AccountStorage["version"] = 1;

function getConfigDir(): string {
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "opencode",
    );
  }

  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "opencode");
}

export function getStoragePath(): string {
  return join(getConfigDir(), "qwen-auth-accounts.json");
}

export function getTrackerStatePath(): string {
  return join(getConfigDir(), "qwen-auth-tracker-state.json");
}

interface TrackerState {
  version: 1;
  health: Record<string, HealthScoreState>;
  tokens: Record<string, TokenBucketState>;
}

export async function loadTrackerState(
  healthTracker: HealthScoreTracker,
  tokenTracker: TokenBucketTracker,
  accounts?: QwenAccount[],
): Promise<void> {
  const path = getTrackerStatePath();
  let content: string;
  let loadedFromFile = false;
  try {
    content = await fs.readFile(path, "utf-8");
    const state = JSON.parse(content) as TrackerState;
    if (state?.version === 1 && state.health && state.tokens) {
      healthTracker.loadFromJSON(state.health);
      tokenTracker.loadFromJSON(state.tokens);
      loadedFromFile = true;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      process.stderr.write(
        `[qwen-oauth] Warning: tracker state at ${path} contains invalid JSON and was ignored.\n`,
      );
    }
  }

  // Seed health tracker from persisted account.health when no tracker state file exists.
  // This bridges the gap on first run or after the tracker state file is missing.
  if (!loadedFromFile && accounts && accounts.length > 0) {
    const maxScore = healthTracker.config.maxScore;
    const seedData: Record<string, HealthScoreState> = {};
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      if (!account?.health) continue;
      const h = account.health;
      const total = h.successCount + h.failureCount;
      if (total === 0) continue;
      const successRate = h.successCount / total;
      const recencyPenalty = Math.min(h.consecutiveFailures * 0.15, 0.5);
      const seedScore = Math.max(
        0,
        Math.round((successRate - recencyPenalty) * maxScore),
      );
      seedData[String(i)] = {
        score: seedScore,
        lastUpdated: h.lastFailure ?? h.lastSuccess ?? Date.now(),
        lastSuccess: h.lastSuccess ?? 0,
        consecutiveFailures: h.consecutiveFailures,
      };
    }
    if (Object.keys(seedData).length > 0) {
      healthTracker.loadFromJSON(seedData);
    }
  }
}

export async function saveTrackerState(
  healthTracker: HealthScoreTracker,
  tokenTracker: TokenBucketTracker,
): Promise<void> {
  const path = getTrackerStatePath();
  const state: TrackerState = {
    version: 1,
    health: healthTracker.toJSON(),
    tokens: tokenTracker.toJSON(),
  };
  try {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    await fs.rename(tempPath, path);
    await fs.chmod(path, 0o600);
  } catch {
    // Non-critical: tracker state persistence failure does not affect operations
  }
}

async function ensureFileExists(path: string): Promise<void> {
  try {
    await fs.access(path);
  } catch {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const empty: AccountStorage = {
      version: STORAGE_VERSION,
      accounts: [],
      activeIndex: 0,
    };
    await fs.writeFile(path, JSON.stringify(empty, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
  }
}

async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  await ensureFileExists(path);
  const release = await acquireFileLock(path, {
    stale: 10000,
    retries: { retries: 5, minTimeout: 100, maxTimeout: 1000, factor: 2 },
  });
  try {
    return await fn();
  } finally {
    await release().catch(() => undefined);
  }
}

function normalizeStorage(storage: AccountStorage): AccountStorage {
  const accounts = storage.accounts.filter((account) =>
    isValidOAuthRefreshToken(account?.refreshToken),
  );
  const activeIndex =
    accounts.length > 0
      ? Math.min(Math.max(storage.activeIndex, 0), accounts.length - 1)
      : 0;
  return { version: STORAGE_VERSION, accounts, activeIndex };
}

function mergeAccounts(
  existing: AccountStorage,
  incoming: AccountStorage,
): AccountStorage {
  const map = new Map<string, QwenAccount>();
  for (const account of existing.accounts) {
    map.set(account.refreshToken, account);
  }
  for (const account of incoming.accounts) {
    const current = map.get(account.refreshToken);
    if (current) {
      map.set(account.refreshToken, {
        ...current,
        ...account,
        lastUsed: Math.max(current.lastUsed, account.lastUsed),
      });
    } else {
      map.set(account.refreshToken, account);
    }
  }
  return normalizeStorage({
    version: STORAGE_VERSION,
    accounts: Array.from(map.values()),
    activeIndex: incoming.activeIndex,
  });
}

export async function loadAccounts(): Promise<AccountStorage | null> {
  const path = getStoragePath();
  let content: string;
  try {
    content = await fs.readFile(path, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(content) as AccountStorage;
    if (
      !parsed ||
      parsed.version !== STORAGE_VERSION ||
      !Array.isArray(parsed.accounts)
    ) {
      process.stderr.write(
        `[qwen-oauth] Warning: account storage at ${path} has unexpected format and was ignored.\n`,
      );
      return null;
    }
    return normalizeStorage(parsed);
  } catch {
    process.stderr.write(
      `[qwen-oauth] Warning: account storage at ${path} contains invalid JSON and was ignored.\n`,
    );
    return null;
  }
}

export async function saveAccounts(storage: AccountStorage): Promise<void> {
  const path = getStoragePath();
  await withFileLock(path, async () => {
    const existing = await loadAccounts();
    const merged = existing
      ? mergeAccounts(existing, storage)
      : normalizeStorage(storage);
    const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await fs.writeFile(tempPath, JSON.stringify(merged, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    await fs.rename(tempPath, path);
    await fs.chmod(path, 0o600);
  });
}

export function upsertAccount(
  storage: AccountStorage,
  account: QwenAccount,
): AccountStorage {
  const index = storage.accounts.findIndex(
    (item) => item.refreshToken === account.refreshToken,
  );
  if (index === -1) {
    return normalizeStorage({
      version: STORAGE_VERSION,
      accounts: [...storage.accounts, account],
      activeIndex: storage.activeIndex,
    });
  }
  const updated = [...storage.accounts];
  updated[index] = {
    ...updated[index],
    ...account,
    lastUsed: account.lastUsed,
  };
  return normalizeStorage({
    version: STORAGE_VERSION,
    accounts: updated,
    activeIndex: storage.activeIndex,
  });
}

export function updateAccount(
  storage: AccountStorage,
  index: number,
  update: Partial<QwenAccount>,
): AccountStorage {
  const accounts = [...storage.accounts];
  const current = accounts[index];
  if (!current) return storage;
  accounts[index] = { ...current, ...update };
  return normalizeStorage({
    version: STORAGE_VERSION,
    accounts,
    activeIndex: storage.activeIndex,
  });
}

export function selectAccount(
  storage: AccountStorage,
  strategy: RotationStrategy,
  now: number,
  options?: SelectAccountOptions,
): { account: QwenAccount; index: number; storage: AccountStorage } | null {
  const total = storage.accounts.length;
  if (total === 0) return null;

  if (strategy === "hybrid") {
    const healthTracker = options?.healthTracker ?? getHealthTracker();
    const tokenTracker = options?.tokenTracker ?? getTokenTracker();
    const pidOffset = options?.pidOffset ?? 0;

    const accountsWithMetrics: AccountWithMetrics[] = storage.accounts.map(
      (account, idx) => ({
        index: idx,
        lastUsed: account.lastUsed,
        healthScore: healthTracker.getScore(idx),
        tokens: tokenTracker.getTokens(idx),
        isRateLimited: !!(
          account.requiresReauth ||
          (account.rateLimitResetAt && account.rateLimitResetAt > now)
        ),
      }),
    );

    if (pidOffset > 0 && accountsWithMetrics.length > 1) {
      const rotateBy = pidOffset % accountsWithMetrics.length;
      for (let i = 0; i < rotateBy; i++) {
        const first = accountsWithMetrics.shift();
        if (first) accountsWithMetrics.push(first);
      }
    }

    const result = selectHybridAccount(
      accountsWithMetrics,
      healthTracker.config.minUsable,
      tokenTracker.getMaxTokens(),
    );

    if (!result) {
      return null;
    }

    const selectedIndex = result.index;
    const selectedAccount = storage.accounts[selectedIndex];
    if (!selectedAccount) return null;

    const consumed = tokenTracker.consume(selectedIndex);
    if (!consumed) {
      return null;
    }

    const updatedAccounts = [...storage.accounts];
    updatedAccounts[selectedIndex] = {
      ...selectedAccount,
      lastUsed: now,
    };
    const updated = normalizeStorage({
      version: STORAGE_VERSION,
      accounts: updatedAccounts,
      activeIndex: selectedIndex,
    });
    return {
      account: updatedAccounts[selectedIndex],
      index: selectedIndex,
      storage: updated,
    };
  }

  if (strategy === "adaptive") {
    const healthTracker = options?.healthTracker ?? getHealthTracker();
    const tokenTracker = options?.tokenTracker ?? getTokenTracker();
    const adaptiveTracker = options?.adaptiveTracker ?? getAdaptiveTracker();
    const pidOffset = options?.pidOffset ?? 0;

    const accountsWithMetrics: AccountWithMetrics[] = storage.accounts.map(
      (account, idx) => ({
        index: idx,
        lastUsed: account.lastUsed,
        healthScore: healthTracker.getScore(idx),
        tokens: tokenTracker.getTokens(idx),
        isRateLimited: !!(
          account.requiresReauth ||
          (account.rateLimitResetAt && account.rateLimitResetAt > now)
        ),
      }),
    );

    if (pidOffset > 0 && accountsWithMetrics.length > 1) {
      const rotateBy = pidOffset % accountsWithMetrics.length;
      for (let i = 0; i < rotateBy; i++) {
        const first = accountsWithMetrics.shift();
        if (first) accountsWithMetrics.push(first);
      }
    }

    const result = adaptiveTracker.selectAccount(
      accountsWithMetrics,
      healthTracker.config.minUsable,
      tokenTracker.getMaxTokens(),
    );

    if (!result) {
      return null;
    }

    const selectedIndex = result.index;
    const selectedAccount = storage.accounts[selectedIndex];
    if (!selectedAccount) return null;

    const consumed = tokenTracker.consume(selectedIndex);
    if (!consumed) {
      return null;
    }

    const updatedAccounts = [...storage.accounts];
    updatedAccounts[selectedIndex] = {
      ...selectedAccount,
      lastUsed: now,
    };
    const updated = normalizeStorage({
      version: STORAGE_VERSION,
      accounts: updatedAccounts,
      activeIndex: selectedIndex,
    });
    return {
      account: updatedAccounts[selectedIndex],
      index: selectedIndex,
      storage: updated,
    };
  }

  const startIndex =
    strategy === "round-robin"
      ? (storage.activeIndex + 1) % total
      : Math.min(storage.activeIndex, total - 1);

  for (let offset = 0; offset < total; offset += 1) {
    const index = (startIndex + offset) % total;
    const account = storage.accounts[index];
    if (!account) continue;
    if (account.requiresReauth) continue;
    if (account.rateLimitResetAt && account.rateLimitResetAt > now) {
      continue;
    }
    const updatedAccounts = [...storage.accounts];
    updatedAccounts[index] = {
      ...account,
      lastUsed: now,
    };
    const updated = normalizeStorage({
      version: STORAGE_VERSION,
      accounts: updatedAccounts,
      activeIndex: index,
    });
    return { account: updatedAccounts[index], index, storage: updated };
  }

  return null;
}

export function markRateLimited(
  storage: AccountStorage,
  index: number,
  retryAfterMs: number,
): AccountStorage {
  const resetAt = Date.now() + retryAfterMs;
  return updateAccount(storage, index, { rateLimitResetAt: resetAt });
}

export function getMinRateLimitWait(
  storage: AccountStorage,
  now: number,
): number | null {
  const waits = storage.accounts
    .map((account) =>
      account.rateLimitResetAt ? account.rateLimitResetAt - now : null,
    )
    .filter((value): value is number => value !== null && value > 0);

  if (waits.length === 0) {
    return null;
  }
  return Math.min(...waits);
}

function ensureHealth(account: QwenAccount): AccountHealth {
  return (
    account.health ?? {
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
    }
  );
}

export function calculateHealthScore(account: QwenAccount): number {
  const health = ensureHealth(account);
  const total = health.successCount + health.failureCount;
  if (total === 0) return 1.0;

  const successRate = health.successCount / total;
  const recencyPenalty = Math.min(health.consecutiveFailures * 0.15, 0.5);

  return Math.max(0, successRate - recencyPenalty);
}

export function recordSuccess(
  storage: AccountStorage,
  index: number,
): AccountStorage {
  const account = storage.accounts[index];
  if (!account) return storage;

  const health = ensureHealth(account);
  return updateAccount(storage, index, {
    health: {
      ...health,
      successCount: health.successCount + 1,
      consecutiveFailures: 0,
      lastSuccess: Date.now(),
    },
  });
}

export function recordFailure(
  storage: AccountStorage,
  index: number,
): AccountStorage {
  const account = storage.accounts[index];
  if (!account) return storage;

  const health = ensureHealth(account);
  return updateAccount(storage, index, {
    health: {
      ...health,
      failureCount: health.failureCount + 1,
      consecutiveFailures: health.consecutiveFailures + 1,
      lastFailure: Date.now(),
    },
  });
}

export function isAccountUsable(
  account: QwenAccount,
  threshold = 0.2,
): boolean {
  return calculateHealthScore(account) >= threshold;
}
