import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { authMiddleware } from '@/middleware/auth.middleware';
import { orgContextMiddleware } from '@/middleware/org-context.middleware';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

function makeApp() {
  const app = new Hono<{
    Variables: {
      userId: string;
      email: string | undefined;
      organizationId: string;
      memberRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
    };
  }>();

  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) {
      return c.json({ code: err.code, detail: err.message }, 401);
    }
    if (err instanceof ForbiddenError) {
      return c.json({ code: err.code, detail: err.message }, 403);
    }
    throw err;
  });

  app.use('*', authMiddleware);
  app.use('/organizations/:orgId/*', orgContextMiddleware);
  app.get('/organizations/:orgId/echo', (c) =>
    c.json({
      organizationId: c.get('organizationId'),
      memberRole: c.get('memberRole'),
    }),
  );
  return app;
}

describe('orgContextMiddleware', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('sets organizationId + memberRole for a member', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const app = makeApp();

    const res = await app.request(`/organizations/${org.id}/echo`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { organizationId: string; memberRole: string };
    expect(body.organizationId).toBe(org.id);
    expect(body.memberRole).toBe('OWNER');
  });

  it('returns 403 when user is NOT a member of the org', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const app = makeApp();

    const res = await app.request(`/organizations/${org.id}/echo`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('returns 403 when the user is a member of a DIFFERENT org', async () => {
    const user = await createAuthenticatedTestUser();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, user.id, 'OWNER');
    const app = makeApp();

    const res = await app.request(`/organizations/${orgB.id}/echo`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(403);
  });

  it('returns 403 when orgId is a non-existent UUID', async () => {
    const user = await createAuthenticatedTestUser();
    const app = makeApp();

    const res = await app.request('/organizations/00000000-0000-0000-0000-000000000000/echo', {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(403);
  });
});
