/**
 * Rate-limit configuration. Single source of truth for the numbers the
 * rate-limit middleware applies. Moving them here keeps `app.ts` and
 * `routes/store.routes.ts` declarative — the limits read like policy,
 * not magic numbers buried in a middleware factory call.
 *
 * The shape matches `RateLimitOptions` from the middleware so each
 * entry can be passed directly: `rateLimit(RATE_LIMITS.GLOBAL)`.
 */

export const RATE_LIMITS = {
  /**
   * Per-user baseline (SECURITY.md §6). Applied to every authenticated
   * request via the global `app.use('*', rateLimit(...))` in app.ts.
   */
  GLOBAL: { max: 300, windowSec: 60, keyPrefix: 'global' },
  /**
   * Connect-store route limit. Tighter than the global baseline because
   * each attempt fires a marketplace probe — abusing it would hit the
   * upstream limits and surface as 5xx for legitimate users.
   */
  STORE_CONNECT: { max: 5, windowSec: 60, keyPrefix: 'stores-connect' },
  /**
   * Trendyol order webhook receiver limit. Bucketed per store (the route
   * supplies a `keyResolver` keyed on the `storeId` path param) since webhook
   * callers are not authenticated users. Generous headroom for a legitimate
   * Trendyol event burst — a busy store can emit dozens of status transitions
   * a minute. A 429 is transient for Trendyol: it retries the failed delivery
   * every 5 minutes, so throttling a flood never loses an event, it defers it.
   */
  WEBHOOK: { max: 120, windowSec: 60, keyPrefix: 'webhook' },
} as const;

/**
 * Internal middleware knobs that callers should not need to tune.
 * Lives in the same file so a deployment doc reviewer sees every number
 * in one place; not exported as part of `RATE_LIMITS` because callers
 * never pass it through `rateLimit(...)`.
 */
export const RATE_LIMIT_INTERNAL = {
  /**
   * In-memory bucket eviction cap. Beyond this, the oldest-inserted key
   * is dropped (cheap LRU). Sized to comfortably hold one window of
   * traffic at the global rate without unbounded growth on a single pod.
   */
  MAX_IN_MEMORY_BUCKETS: 10_000,
} as const;
