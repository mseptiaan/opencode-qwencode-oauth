import { transformHeader } from "../../transform/header";
import {
  createTransformContext,
  transformChatCompletionsToResponses,
} from "../../transform/response";
import {
  createSSETransformContext,
  createSSETransformStream,
} from "../../transform/sse";
import type { AccountStorage, QwenAccount } from "../account";
import type { LoadedConfig } from "../config/loader";
import { createLogger } from "../logger";
import type { AdaptiveTracker } from "../rotation/adaptive";
import type { HealthScoreTracker } from "../rotation/health";
import type { TokenBucketTracker } from "../rotation/token-bucket";
import type { OAuthAuthDetails } from "../types";
import {
  calculateBackoff,
  isRateLimitedOrServerError,
  sleep,
} from "./rate-limit";
import { transformRequestAsync } from "./transform";

const logger = createLogger("fetch");

export interface FetchContext {
  config: LoadedConfig;
  accountStorage: AccountStorage;
  healthTracker: HealthScoreTracker;
  tokenTracker: TokenBucketTracker;
  adaptiveTracker: AdaptiveTracker;
  oauthOptions: {
    clientId: string;
    oauthBaseUrl: string;
    scopes: string[];
  };
  refreshAccessToken: (
    auth: OAuthAuthDetails,
  ) => Promise<OAuthAuthDetails | null>;
  pidOffset: number;
}

export interface FetchResult {
  response: Response;
  accountIndex: number;
  storage: AccountStorage;
}

export async function authenticatedFetch(
  ctx: FetchContext,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<FetchResult> {
  let attempts = 0;
  let accountStorage = ctx.accountStorage;
  const totalAccounts = accountStorage.accounts.length;

  while (true) {
    const now = Date.now();
    const selection = selectAccountForRequest(ctx, accountStorage, now);

    if (!selection) {
      const waitMs = getMinRateLimitWait(accountStorage, now);
      if (!waitMs) {
        throw new Error(
          "No available Qwen OAuth accounts. Re-authenticate to continue.",
        );
      }

      const maxWaitMs = ctx.config.max_rate_limit_wait_seconds * 1000;
      if (maxWaitMs > 0 && waitMs > maxWaitMs) {
        throw new Error(
          "All Qwen OAuth accounts are rate-limited. Try again later.",
        );
      }

      logger.debug("All accounts rate limited, waiting", { waitMs });
      await sleep(waitMs);
      continue;
    }

    const { account, accountIndex } = selection;
    accountStorage = selection.storage;

    let activeAuth: OAuthAuthDetails = {
      type: "oauth",
      refresh: account.refreshToken,
      access: account.accessToken,
      expires: account.expires,
      resourceUrl: account.resourceUrl,
    };

    const refreshBuffer = ctx.config.proactive_refresh
      ? ctx.config.refresh_window_seconds
      : 0;

    if (!activeAuth.access || accessTokenExpired(activeAuth, refreshBuffer)) {
      logger.debug("Token refresh needed", { accountIndex });
      try {
        const refreshed = await ctx.refreshAccessToken(activeAuth);
        if (!refreshed) {
          throw new Error("Token refresh failed");
        }
        activeAuth = refreshed;
        accountStorage = updateAccountInStorage(accountStorage, accountIndex, {
          refreshToken: refreshed.refresh,
          accessToken: refreshed.access,
          expires: refreshed.expires,
          resourceUrl: refreshed.resourceUrl ?? account.resourceUrl,
          lastUsed: now,
        });
      } catch (error) {
        const err = error as Error & { code?: string };
        logger.debug("Token refresh failed", {
          accountIndex,
          code: err.code,
        });
        if (["invalid_grant", "invalid_token"].includes(err.code ?? "")) {
          accountStorage = updateAccountInStorage(
            accountStorage,
            accountIndex,
            {
              requiresReauth: true,
              accessToken: undefined,
              expires: undefined,
            },
          );
          attempts += 1;
          if (attempts >= totalAccounts) {
            throw error;
          }
          continue;
        }
        throw error;
      }
    }

    const transformed = await transformRequestAsync(input, init);
    const headers = transformHeader(transformed.init.headers, {
      accessToken: activeAuth.access,
      forceJsonContentType: transformed.needsResponsesTransform,
    });

    logger.debug("Sending request", {
      url: transformed.url,
      method: transformed.init.method ?? "POST",
    });

    const response = await fetch(transformed.url, {
      ...transformed.init,
      headers,
    });

    logger.debug("Response received", {
      status: response.status,
    });

    if (
      transformed.needsResponsesTransform &&
      response.ok &&
      response.body &&
      response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      const sseCtx = createSSETransformContext(logger);
      const transformStream = createSSETransformStream(sseCtx);
      const transformedBody = response.body.pipeThrough(transformStream);
      return {
        response: new Response(transformedBody, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
        accountIndex,
        storage: accountStorage,
      };
    }

    if (
      transformed.needsResponsesTransform &&
      response.ok &&
      !response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      logger.debug("Transforming non-streaming response");
      const chatBody = await response.json();
      const ctx2 = createTransformContext();
      const responsesBody = transformChatCompletionsToResponses(chatBody, ctx2);
      return {
        response: new Response(JSON.stringify(responsesBody), {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers({ "content-type": "application/json" }),
        }),
        accountIndex,
        storage: accountStorage,
      };
    }

    if (isRateLimitedOrServerError(response.status)) {
      const backoffMs = calculateBackoff(response, attempts);
      logger.debug("Rate limited or server error", {
        status: response.status,
        accountIndex,
        backoffMs,
      });

      accountStorage = markRateLimited(accountStorage, accountIndex, backoffMs);
      ctx.healthTracker.recordRateLimit(accountIndex);
      if (ctx.config.rotation_strategy === "adaptive") {
        ctx.adaptiveTracker.recordRateLimit(accountIndex);
      }

      attempts += 1;
      if (attempts >= totalAccounts) {
        const waitMs = getMinRateLimitWait(accountStorage, Date.now());
        if (waitMs) {
          logger.debug("All accounts rate limited, waiting", { waitMs });
          await sleep(waitMs);
          attempts = 0;
          continue;
        }
        return { response, accountIndex, storage: accountStorage };
      }
      continue;
    }

    ctx.healthTracker.recordSuccess(accountIndex);
    if (ctx.config.rotation_strategy === "adaptive") {
      ctx.adaptiveTracker.recordSuccess(accountIndex);
    }

    return { response, accountIndex, storage: accountStorage };
  }
}

function accessTokenExpired(
  auth: OAuthAuthDetails,
  bufferSeconds: number,
): boolean {
  if (!auth.expires) return true;
  return Date.now() + bufferSeconds * 1000 >= auth.expires;
}

function selectAccountForRequest(
  ctx: FetchContext,
  storage: AccountStorage,
  now: number,
): {
  account: QwenAccount;
  accountIndex: number;
  storage: AccountStorage;
} | null {
  const strategy = ctx.config.rotation_strategy;
  const accounts = storage.accounts.filter((_, i) => {
    const acc = storage.accounts[i];
    if (!acc) return false;
    if (acc.requiresReauth) return false;
    if (acc.rateLimitResetAt && acc.rateLimitResetAt > now) return false;
    return true;
  });

  if (accounts.length === 0) return null;

  if (strategy === "adaptive") {
    const metrics = storage.accounts.map((acc, idx) => ({
      index: idx,
      lastUsed: acc.lastUsed,
      healthScore: ctx.healthTracker.getScore(idx),
      tokens: ctx.tokenTracker.getTokens(idx),
      isRateLimited: !!(
        acc.requiresReauth ||
        (acc.rateLimitResetAt && acc.rateLimitResetAt > now)
      ),
    }));

    if (ctx.pidOffset > 0 && metrics.length > 1) {
      const rotateBy = ctx.pidOffset % metrics.length;
      for (let i = 0; i < rotateBy; i++) {
        const first = metrics.shift();
        if (first) metrics.push(first);
      }
    }

    const result = ctx.adaptiveTracker.selectAccount(
      metrics,
      ctx.healthTracker.config.minUsable,
      ctx.tokenTracker.getMaxTokens(),
    );

    if (!result) return null;

    const selectedIndex = result.index;
    const selectedAccount = storage.accounts[selectedIndex];
    if (!selectedAccount) return null;

    if (!ctx.tokenTracker.consume(selectedIndex)) return null;

    const updated = updateAccountInStorage(storage, selectedIndex, {
      lastUsed: now,
    });

    return {
      account: updated.accounts[selectedIndex],
      accountIndex: selectedIndex,
      storage: updated,
    };
  }

  const startIndex =
    strategy === "round-robin"
      ? (storage.activeIndex + 1) % storage.accounts.length
      : Math.min(storage.activeIndex, storage.accounts.length - 1);

  for (let offset = 0; offset < storage.accounts.length; offset++) {
    const index = (startIndex + offset) % storage.accounts.length;
    const account = storage.accounts[index];
    if (!account) continue;
    if (account.requiresReauth) continue;
    if (account.rateLimitResetAt && account.rateLimitResetAt > now) continue;

    const updated = updateAccountInStorage(storage, index, { lastUsed: now });
    return {
      account: updated.accounts[index],
      accountIndex: index,
      storage: updated,
    };
  }

  return null;
}

function updateAccountInStorage(
  storage: AccountStorage,
  index: number,
  update: Partial<QwenAccount>,
): AccountStorage {
  const accounts = [...storage.accounts];
  const current = accounts[index];
  if (!current) return storage;
  accounts[index] = { ...current, ...update };
  return { ...storage, accounts };
}

function markRateLimited(
  storage: AccountStorage,
  index: number,
  retryAfterMs: number,
): AccountStorage {
  return updateAccountInStorage(storage, index, {
    rateLimitResetAt: Date.now() + retryAfterMs,
  });
}

function getMinRateLimitWait(
  storage: AccountStorage,
  now: number,
): number | null {
  const waits = storage.accounts
    .map((acc) => (acc.rateLimitResetAt ? acc.rateLimitResetAt - now : null))
    .filter((v): v is number => v !== null && v > 0);

  return waits.length > 0 ? Math.min(...waits) : null;
}
