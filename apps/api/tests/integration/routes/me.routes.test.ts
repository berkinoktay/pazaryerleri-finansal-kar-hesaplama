import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';

describe('GET /v1/me', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without a token', async () => {
    const res = await app.request('/v1/me');
    expect(res.status).toBe(401);
  });

  it('returns the authenticated user’s profile with defaults', async () => {
    const user = await createAuthenticatedTestUser();

    const res = await app.request('/v1/me', {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      email: string;
      timezone: string;
      preferredLanguage: string;
    };
    expect(body.id).toBe(user.id);
    expect(body.email).toBe(user.email);
    expect(body.timezone).toBe('Europe/Istanbul');
    expect(body.preferredLanguage).toBe('tr');
  });

  it('auto-upserts a profile row if the trigger missed it', async () => {
    const user = await createAuthenticatedTestUser();
    // Simulate a legacy user (pre-trigger) by deleting the profile row
    // that `createAuthenticatedTestUser` seeds via upsert. The GET
    // handler must transparently re-create it.
    await prisma.userProfile.delete({ where: { id: user.id } });

    const res = await app.request('/v1/me', {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
    const reloaded = await prisma.userProfile.findUnique({ where: { id: user.id } });
    expect(reloaded).not.toBeNull();
  });
});
