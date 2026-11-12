import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RATE_LIMIT_INTERNAL } from '../../../src/config/rate-limits';
import { RateLimitedError } from '../../../src/lib/errors';
import {
  _resetRateLimitStoreForTests,
  rateLimit,
} from '../../../src/middleware/rate-limit.middleware';

interface TestVariables {
  Variables: { userId: string };
}

interface TestLimitOptions {
  max: number;
  windowSec: number;
  keyPrefix?: string;
}

const MAX_BUCKETS = RATE_LIMIT_INTERNAL.MAX_IN_MEMORY_BUCKETS;
/** How often the busy user re-touches its bucket while other keys churn. */
const TOUCH_EVERY = 1_000;

function withTestRoute(app: Hono<TestVariables>): Hono<TestVariables> {
  app.get('/test', (c) => c.text('ok'));
  app.onError((err, c) => {
    if (err instanceof RateLimitedError) {
      return c.json({ code: err.code, retryAfter: err.retryAfterSeconds }, 429);
    }
    return c.json({ code: 'UNEXPECTED', message: err.message }, 500);
  });
  return app;
}

function appFor(userId: string | null, opts: TestLimitOptions) {
  const app = new Hono<TestVariables>();
  app.use('*', async (c, next) => {
    if (userId !== null) c.set('userId', userId);
    await next();
  });
  app.use('*', rateLimit(opts));
  return withTestRoute(app);
}

/** Like `appFor`, but the user id comes from the `x-user` header so one app serves many users. */
function appForUserHeader(opts: TestLimitOptions) {
  const app = new Hono<TestVariables>();
  app.use('*', async (c, next) => {
    const userId = c.req.header('x-user');
    if (userId !== undefined) c.set('userId', userId);
    await next();
  });
  app.use('*', rateLimit(opts));
  return withTestRoute(app);
}

/** Unauthenticated app: the identity comes from a `keyResolver` reading the `x-key` header. */
function appForResolverKey(opts: TestLimitOptions) {
  const app = new Hono<TestVariables>();
  app.use('*', rateLimit({ ...opts, keyResolver: (c) => c.req.header('x-key') ?? '' }));
  return withTestRoute(app);
}

describe('rateLimit middleware', () => {
  beforeEach(() => {
    _resetRateLimitStoreForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows the first `max` requests and rejects the next one', async () => {
    const app = appFor('user-a', { max: 3, windowSec: 60, keyPrefix: 'test' });

    for (let i = 0; i < 3; i++) {
      const res = await app.request('/test');
      expect(res.status).toBe(200);
    }
    const res = await app.request('/test');
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string; retryAfter: number };
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('resets the window after windowSec elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T00:00:00Z'));

    const app = appFor('user-a', { max: 2, windowSec: 30, keyPrefix: 'test' });
    await app.request('/test');
    await app.request('/test');
    const first429 = await app.request('/test');
    expect(first429.status).toBe(429);

    // Advance past the window.
    vi.setSystemTime(new Date('2026-04-21T00:00:31Z'));
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('isolates counters between users', async () => {
    const appA = appFor('user-a', { max: 1, windowSec: 60, keyPrefix: 'test' });
    const appB = appFor('user-b', { max: 1, windowSec: 60, keyPrefix: 'test' });

    expect((await appA.request('/test')).status).toBe(200);
    expect((await appA.request('/test')).status).toBe(429);
    // user-b's bucket is untouched by user-a's overflow.
    expect((await appB.request('/test')).status).toBe(200);
  });

  it('isolates counters between keyPrefix namespaces for the same user', async () => {
    const appX = appFor('user-a', { max: 1, windowSec: 60, keyPrefix: 'route-x' });
    const appY = appFor('user-a', { max: 1, windowSec: 60, keyPrefix: 'route-y' });

    expect((await appX.request('/test')).status).toBe(200);
    expect((await appX.request('/test')).status).toBe(429);
    // Different keyPrefix → fresh bucket.
    expect((await appY.request('/test')).status).toBe(200);
  });

  it('no-ops (passes through) when userId is not on context', async () => {
    const app = appFor(null, { max: 1, windowSec: 60, keyPrefix: 'test' });

    // Even 10 rapid requests all succeed — we skip counting without auth.
    for (let i = 0; i < 10; i++) {
      expect((await app.request('/test')).status).toBe(200);
    }
  });

  it('a recently used bucket survives eviction', async () => {
    const app = appForUserHeader({ max: 3, windowSec: 60, keyPrefix: 'test' });
    const asUser = (userId: string) => app.request('/test', { headers: { 'x-user': userId } });

    for (let i = 0; i < 3; i++) {
      expect((await asUser('user-a')).status).toBe(200);
    }

    // Push MAX_BUCKETS + 1 other user keys through the same map. Every
    // TOUCH_EVERY keys user A makes another (rejected) request, which must
    // keep its bucket among the most recently used and out of eviction.
    for (let i = 0; i <= MAX_BUCKETS; i++) {
      if (i % TOUCH_EVERY === 0) {
        expect((await asUser('user-a')).status).toBe(429);
      }
      expect((await asUser(`churn-user-${i}`)).status).toBe(200);
    }

    expect((await asUser('user-a')).status).toBe(429);
  });

  it('resolver keys never evict user buckets', async () => {
    const userApp = appFor('user-a', { max: 3, windowSec: 60, keyPrefix: 'test' });
    const resolverApp = appForResolverKey({ max: 3, windowSec: 60, keyPrefix: 'test' });

    for (let i = 0; i < 3; i++) {
      expect((await userApp.request('/test')).status).toBe(200);
    }
    expect((await userApp.request('/test')).status).toBe(429);

    // An unauthenticated caller floods MAX_BUCKETS + 1 distinct resolver
    // identities (e.g. random storeIds on the webhook route).
    for (let i = 0; i <= MAX_BUCKETS; i++) {
      const res = await resolverApp.request('/test', {
        headers: { 'x-key': `forged-store-${i}` },
      });
      expect(res.status).toBe(200);
    }

    expect((await userApp.request('/test')).status).toBe(429);
  });
});
