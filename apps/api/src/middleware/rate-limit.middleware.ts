/**
 * Per-user, per-route fixed-window rate limit.
 *
 * Emits RateLimitedError on overflow — the RFC 7807 pipeline (PR #34)
 * handles 429 + Retry-After header, so no downstream wiring here.
 *
 * Backend is an in-memory Map. Known MVP limits:
 *   - Single-pod only: counts are per-process. Multi-pod deploys count
 *     independently; overall rate = pods × max.
 *   - Process restart resets windows. A user who just hit 429 could
 *     retry immediately after a deploy.
 *   - LRU-ish eviction at MAX_KEYS to avoid unbounded memory.
 *
 * When scaling past one pod, the public shape (rateLimit factory +
 * RateLimitOptions) stays identical; only the backing Map swaps for
 * Postgres or Upstash Redis.
 */

import { createMiddleware } from 'hono/factory';

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
}

interface Bucket {
  count: number;
  windowStart: number;
}

const MAX_KEYS = 10_000;
const store = new Map<string, Bucket>();

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware(async (c, next) => {
    const userId = c.get('userId');
    // No user context → skip. The global auth middleware should have
    // rejected upstream; we do NOT throw here to keep this middleware
    // composable with unauthenticated routes (none today, but cheap
    // future-proofing).
    if (typeof userId !== 'string' || userId.length === 0) {
      await next();
      return;
    }

    const prefix = opts.keyPrefix ?? c.req.routePath;
    const key = `${userId}:${prefix}`;
    const now = Date.now();

    let bucket = store.get(key);
    const windowMs = opts.windowSec * 1000;
    if (bucket === undefined || now - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: now };
    }
    bucket.count += 1;

    if (bucket.count > opts.max) {
      const retryAfterMs = bucket.windowStart + windowMs - now;
      const retryAfterSeconds = Math.max(Math.ceil(retryAfterMs / 1000), 1);
      throw new RateLimitedError(retryAfterSeconds);
    }

    store.set(key, bucket);

    // Cheap LRU: when the store exceeds MAX_KEYS, evict the oldest
    // insertion (Map.keys() iterates in insertion order).
    if (store.size > MAX_KEYS) {
      const oldestKey = store.keys().next().value;
      if (oldestKey !== undefined) store.delete(oldestKey);
    }

    await next();
  });
}

/**
 * Test-only helper: clears the in-memory store between tests so each
 * test starts with an empty bucket set. NOT exported from index.ts —
 * only the middleware factory is a stable public surface.
 */
export function _resetRateLimitStoreForTests(): void {
  store.clear();
}
