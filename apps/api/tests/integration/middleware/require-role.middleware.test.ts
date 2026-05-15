import type { MemberRole } from '@pazarsync/db';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { authMiddleware } from '@/middleware/auth.middleware';
import { orgContextMiddleware } from '@/middleware/org-context.middleware';
import { requireRole } from '@/middleware/require-role.middleware';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

function makeApp(allowedRoles: MemberRole[]) {
  const app = new Hono<{
    Variables: {
      userId: string;
      email: string | undefined;
      organizationId: string;
      memberRole: MemberRole;
    };
  }>();

  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) {
      return c.json({ code: err.code, detail: err.message }, 401);
    }
    if (err instanceof ForbiddenError) {
      return c.json({ code: err.code, detail: err.message }, 403);
    }
    return c.json({ code: 'INTERNAL_ERROR', detail: err.message }, 500);
  });

  app.use('*', authMiddleware);
  app.use('/organizations/:orgId/*', orgContextMiddleware);
  app.use('/organizations/:orgId/*', requireRole(...allowedRoles));
  app.get('/organizations/:orgId/echo', (c) => c.json({ memberRole: c.get('memberRole') }));
  return app;
}

/**
 * App that mounts requireRole WITHOUT orgContext upstream. Used to assert
 * that an auth-chain ordering bug surfaces as 500, not 403 — hiding it
 * behind a forbidden response would let the bug ship silently.
 */
function makeAppWithoutOrgContext(allowedRoles: MemberRole[]) {
  const app = new Hono<{
    Variables: {
      userId: string;
      email: string | undefined;
      memberRole: MemberRole;
    };
  }>();

  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) {
      return c.json({ code: err.code, detail: err.message }, 401);
    }
    if (err instanceof ForbiddenError) {
      return c.json({ code: err.code, detail: err.message }, 403);
    }
    return c.json({ code: 'INTERNAL_ERROR', detail: err.message }, 500);
  });

  app.use('*', authMiddleware);
  app.use('*', requireRole(...allowedRoles));
  app.get('/echo', (c) => c.json({ ok: true }));
  return app;
}

describe('requireRole middleware', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('allows OWNER when OWNER is in the allowed roles', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const app = makeApp(['OWNER', 'ADMIN']);

    const res = await app.request(`/organizations/${org.id}/echo`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { memberRole: MemberRole };
    expect(body.memberRole).toBe('OWNER');
  });

  it('allows ADMIN when ADMIN is in the allowed roles', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'ADMIN');
    const app = makeApp(['OWNER', 'ADMIN']);

    const res = await app.request(`/organizations/${org.id}/echo`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
  });

  it('rejects MEMBER with 403 FORBIDDEN when MEMBER is not in the allowed roles', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'MEMBER');
    const app = makeApp(['OWNER', 'ADMIN']);

    const res = await app.request(`/organizations/${org.id}/echo`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe('FORBIDDEN');
    // The forbidden detail should not leak which roles were required —
    // role policy is server-side, error response stays generic.
    expect(body.detail).not.toMatch(/OWNER|ADMIN|MEMBER|VIEWER/);
  });

  it('rejects VIEWER with 403 FORBIDDEN', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'VIEWER');
    const app = makeApp(['OWNER', 'ADMIN']);

    const res = await app.request(`/organizations/${org.id}/echo`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(403);
  });

  it('allows the role only when listed — single-role gate', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'ADMIN');
    const app = makeApp(['OWNER']);

    const res = await app.request(`/organizations/${org.id}/echo`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(403);
  });

  it('returns 500 (not 403) when memberRole is missing on context — auth-chain ordering bug', async () => {
    const user = await createAuthenticatedTestUser();
    const app = makeAppWithoutOrgContext(['OWNER']);

    const res = await app.request('/echo', {
      headers: { Authorization: bearer(user.accessToken) },
    });

    // The middleware throws plain Error (not ForbiddenError) so the
    // ordering bug surfaces. If this ever flips to 403 the regression
    // would hide a real production misconfiguration.
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.detail).toMatch(/memberRole/i);
  });
});
