import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimitedError } from '../../../src/lib/errors';
import {
  _resetRateLimitStoreForTests,
  rateLimit,
} from '../../../src/middleware/rate-limit.middleware';

interface TestVariables {
  Variables: { userId: string };
}

function appFor(
  userId: string | null,
  opts: { max: number; windowSec: number; keyPrefix?: string },
) {
  const app = new Hono<TestVariables>();
  app.use('*', async (c, next) => {
    if (userId !== null) c.set('userId', userId);
    await next();
  });
  app.use('*', rateLimit(opts));
  app.get('/test', (c) => c.text('ok'));
  app.onError((err, c) => {
    if (err instanceof RateLimitedError) {
      return c.json({ code: err.code, retryAfter: err.retryAfterSeconds }, 429);
    }
    return c.json({ code: 'UNEXPECTED', message: err.message }, 500);
  });
  return app;
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
});
