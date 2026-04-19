import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { UnauthorizedError } from '../../../src/lib/errors';
import { authMiddleware } from '../../../src/middleware/auth.middleware';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';

function makeApp() {
  const app = new Hono<{ Variables: { userId: string; email: string | undefined } }>();

  // Local onError mirroring the real createApp() shape so middleware throws
  // surface as 401 JSON responses in this isolated test harness.
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) {
      return c.json({ code: err.code, detail: err.message }, 401);
    }
    throw err;
  });

  app.use('*', authMiddleware);
  app.get('/echo', (c) => c.json({ userId: c.get('userId'), email: c.get('email') }));
  return app;
}

describe('authMiddleware', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('sets userId + email on context for a valid Supabase-issued token', async () => {
    const user = await createAuthenticatedTestUser();
    const app = makeApp();

    const res = await app.request('/echo', {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; email: string };
    expect(body.userId).toBe(user.id);
    expect(body.email).toBe(user.email);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const app = makeApp();
    const res = await app.request('/echo');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 when Authorization header is not Bearer', async () => {
    const app = makeApp();
    const res = await app.request('/echo', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for a malformed/garbage Bearer token', async () => {
    const app = makeApp();
    const res = await app.request('/echo', {
      headers: { Authorization: bearer('this-is-not-a-jwt') },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for a well-shaped JWT that Supabase did not sign', async () => {
    const app = makeApp();
    // Any unsigned / wrong-key JWT — Supabase's getUser rejects it.
    const fake =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIiwiZXhwIjo5OTk5OTk5OTk5fQ.not-a-real-signature';
    const res = await app.request('/echo', {
      headers: { Authorization: bearer(fake) },
    });
    expect(res.status).toBe(401);
  });
});
