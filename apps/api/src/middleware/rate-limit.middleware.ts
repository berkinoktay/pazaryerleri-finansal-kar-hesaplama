/**
 * Per-user, per-route fixed-window rate limit.
 *
 * Emits RateLimitedError on overflow — the RFC 7807 pipeline (PR #34)
 * handles 429 + Retry-After header, so no downstream wiring here.
 *
 * Backend is two in-memory Maps, each capped at MAX_KEYS with true LRU
 * eviction:
 *   - `userStore` holds buckets keyed on the authenticated user id.
 *   - `resolverStore` holds buckets whose identity came from a
 *     `keyResolver` (unauthenticated callers, e.g. the webhook receiver,
 *     which rate-limits before signature verification). An attacker can
 *     mint unlimited resolver identities, so they live apart: a flood of
 *     forged keys only churns its own map and never evicts a user bucket.
 *   - Every hit, including one that is rejected with 429, re-inserts the
 *     bucket (`delete` + `set`), so Map iteration order is recency order
 *     and the first key is always the least recently used.
 *
 * Known MVP limits:
 *   - Single-pod only: counts are per-process. Multi-pod deploys count
 *     independently; overall rate = pods × max.
 *   - Process restart resets windows. A user who just hit 429 could
 *     retry immediately after a deploy.
 *
 * When scaling past one pod, the public shape (rateLimit factory +
 * RateLimitOptions) stays identical; only the backing Maps swap for
 * Postgres or Upstash Redis.
 */

import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import { RATE_LIMIT_INTERNAL } from '../config/rate-limits';
import { RateLimitedError } from '../lib/errors';

export interface RateLimitOptions {
  /** Max requests allowed in the window. */
  max: number;
  /** Window length in seconds. */
  windowSec: number;
  /**
   * Key namespace. Defaults to `c.req.routePath`, which is a stable
   * server-side pattern (e.g. `/organizations/:orgId/stores`) — not the
   * client-substituted URL. Pass explicitly when the same route needs
   * a separate bucket (e.g. POST vs GET sharing a path).
   */
  keyPrefix?: string;
  /**
   * Overrides the default per-user identity. Authenticated routes bucket by
   * `c.get('userId')`; unauthenticated routes (e.g. the marketplace webhook
   * receiver, which runs before the JWT auth middleware) have no user, so they
   * pass a resolver that derives a stable identity from the request (e.g. the
   * `storeId` path param). Return a non-empty string to bucket, or an empty
   * string to fall through unlimited.
   */
  keyResolver?: (c: Context) => string;
}

interface Bucket {
  count: number;
  windowStart: number;
}

const MAX_KEYS = RATE_LIMIT_INTERNAL.MAX_IN_MEMORY_BUCKETS;
/** Buckets keyed on the authenticated user id. */
const userStore = new Map<string, Bucket>();
/** Buckets keyed on a `keyResolver` identity (unauthenticated callers). */
const resolverStore = new Map<string, Bucket>();

/** Default identity source for authenticated routes: the Supabase user id. */
function resolveUserIdentity(c: Context): string {
  const userId = c.get('userId');
  return typeof userId === 'string' ? userId : '';
}

/**
 * Moves `key` to the most-recently-used end of `store` (Map iteration order
 * is insertion order, so `delete` + `set` re-inserts it last), then evicts
 * the least recently used key once the map exceeds MAX_KEYS.
 */
function touchBucket(store: Map<string, Bucket>, key: string, bucket: Bucket): void {
  store.delete(key);
  store.set(key, bucket);

  if (store.size > MAX_KEYS) {
    const leastRecentKey = store.keys().next().value;
    if (leastRecentKey !== undefined) store.delete(leastRecentKey);
  }
}

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware(async (c, next) => {
    // Identity resolution: an explicit `keyResolver` wins (unauthenticated
    // routes derive their own key), otherwise fall back to the authenticated
    // user id. Absent identity → skip. For authenticated routes the global
    // auth middleware should have rejected upstream; we do NOT throw here to
    // keep this middleware composable with unauthenticated routes.
    const resolver = opts.keyResolver;
    const identity = resolver !== undefined ? resolver(c) : resolveUserIdentity(c);
    if (identity.length === 0) {
      await next();
      return;
    }

    // Resolver identities are caller-controlled, so they get their own map
    // and can never push a user bucket out.
    const store = resolver !== undefined ? resolverStore : userStore;
    const prefix = opts.keyPrefix ?? c.req.routePath;
    const key = `${identity}:${prefix}`;
    const now = Date.now();

    let bucket = store.get(key);
    const windowMs = opts.windowSec * 1000;
    if (bucket === undefined || now - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: now };
    }
    bucket.count += 1;

    // Touch before the overflow check: a caller that keeps hitting 429 is
    // still active, so its bucket must stay fresh rather than age out and
    // hand it a new window.
    touchBucket(store, key, bucket);

    if (bucket.count > opts.max) {
      const retryAfterMs = bucket.windowStart + windowMs - now;
      const retryAfterSeconds = Math.max(Math.ceil(retryAfterMs / 1000), 1);
      throw new RateLimitedError(retryAfterSeconds);
    }

    await next();
  });
}

/**
 * Test-only helper: clears both in-memory stores between tests so each
 * test starts with an empty bucket set. NOT exported from index.ts —
 * only the middleware factory is a stable public surface.
 */
export function _resetRateLimitStoreForTests(): void {
  userStore.clear();
  resolverStore.clear();
}
