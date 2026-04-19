import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { UnauthorizedError } from '../../../src/lib/errors';
import { authMiddleware } from '../../../src/middleware/auth.middleware';
import { bearer, signTestJwt } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createUserProfile } from '../../helpers/factories';

function makeApp() {
  const app = new Hono<{ Variables: { userId: string; email: string | undefined } }>();

  // Local onError so middleware throws produce a 401 JSON response.
  // The real createApp() has the same mapping; we duplicate minimal shape
  // here so this test does not depend on the full app being wired.
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) {
      return c.json({ code: err.code, detail: err.message }, 401);
    }
    throw err;
  });

  app.use('*', authMiddleware);
  app.get('/echo', (c) => c.json({ userId: c.get('userId') }));
  return app;
}

describe('authMiddleware', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('sets userId on context for a valid token', async () => {
    const user = await createUserProfile();
    const token = await signTestJwt(user.id);
    const app = makeApp();

    const res = await app.request('/echo', {
      headers: { Authorization: bearer(token) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe(user.id);
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

  it('returns 401 for a token with wrong signature', async () => {
    const app = makeApp();
    const res = await app.request('/echo', {
      headers: { Authorization: bearer('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalid') },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const user = await createUserProfile();
    const token = await signTestJwt(user.id, { expiresIn: '-1h' });
    const app = makeApp();

    const res = await app.request('/echo', {
      headers: { Authorization: bearer(token) },
    });
    expect(res.status).toBe(401);
  });
});
