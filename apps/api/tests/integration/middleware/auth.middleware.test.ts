import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { UnauthorizedError } from '@/lib/errors';
import { authMiddleware } from '@/middleware/auth.middleware';
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

  it('returns 401 when Authorization header is an empty string', async () => {
    const app = makeApp();
    const res = await app.request('/echo', {
      headers: { Authorization: '' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 when header is the bare word "Bearer" with no token', async () => {
    const app = makeApp();
    const res = await app.request('/echo', {
      headers: { Authorization: 'Bearer' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when header is "Bearer " with trailing whitespace and no token', async () => {
    const app = makeApp();
    const res = await app.request('/echo', {
      headers: { Authorization: 'Bearer   ' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts a lowercase "bearer" prefix — case-insensitive per RFC 6750 §2.1', async () => {
    // Pinning the case-insensitive match in regex `/^Bearer\s+(.+)$/i`
    // so a future tightening of the parser does not break legitimate
    // clients that send lowercase or mixed case.
    const user = await createAuthenticatedTestUser();
    const app = makeApp();
    const res = await app.request('/echo', {
      headers: { Authorization: `bearer ${user.accessToken}` },
    });
    expect(res.status).toBe(200);
  });

  it('accepts double whitespace between "Bearer" and token', async () => {
    // The `\s+` quantifier eats one-or-more whitespace; locking this down
    // so a proxy that re-emits the header with extra padding does not 401.
    const user = await createAuthenticatedTestUser();
    const app = makeApp();
    const res = await app.request('/echo', {
      headers: { Authorization: `Bearer  ${user.accessToken}` },
    });
    expect(res.status).toBe(200);
  });

  it('returns 401 when the token was valid but the user has since been deleted', async () => {
    // Real-world scenario: user signs in, gets a token, admin deletes
    // their auth.users row before the token TTL expires. Supabase's
    // `getUser(token)` must reject the now-orphaned token, otherwise an
    // attacker with an exfiltrated token retains access past the
    // intended revocation point.
    const user = await createAuthenticatedTestUser();
    const app = makeApp();

    // Sanity check — token works while user exists.
    const before = await app.request('/echo', {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(before.status).toBe(200);

    // Delete via admin API, mirroring an org-admin-removes-member flow.
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env['SUPABASE_URL'];
    const secret = process.env['SUPABASE_SECRET_KEY'];
    if (url === undefined || url.length === 0 || secret === undefined || secret.length === 0) {
      throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set for this test');
    }
    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
    expect(deleteErr).toBeNull();

    const after = await app.request('/echo', {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(after.status).toBe(401);
    const body = (await after.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });
});
