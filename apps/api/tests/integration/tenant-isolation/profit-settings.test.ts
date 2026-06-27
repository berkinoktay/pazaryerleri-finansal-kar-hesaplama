/**
 * Multi-tenancy isolation tests for the profit-settings routes.
 *
 * Two invariants (mirrors shipping-config.test.ts — same store-scoped pattern):
 *
 *   1. Store-scoped lookups filter by `(id, organizationId)` together — an org A
 *      member who passes an org A org-id but an org B store-id in the URL gets
 *      404 NOT_FOUND (existence non-disclosure), never a leak. Both GET and PATCH
 *      enforce this (different code paths — both verified).
 *
 *   2. PATCH is gated by STORES_CONFIGURE (OWNER/ADMIN). A plain MEMBER of the
 *      SAME org gets 403 FORBIDDEN — changing the profit formula is sensitive.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

interface ProblemDetailsWire {
  code: string;
  status: number;
}

describe('Tenant isolation — profit-settings routes', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('user from org A cannot GET profit-settings of an org B store', async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/profit-settings`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as ProblemDetailsWire;
    expect(body.code).toBe('NOT_FOUND');
  });

  it('user from org A cannot PATCH profit-settings of an org B store', async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/profit-settings`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(userA.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ includeNegativeNetVat: true }),
      },
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as ProblemDetailsWire;
    expect(body.code).toBe('NOT_FOUND');
  });

  it('a MEMBER cannot PATCH profit-settings (requires STORES_CONFIGURE)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'MEMBER');
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/profit-settings`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(user.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ includeStopaj: false }),
      },
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as ProblemDetailsWire;
    expect(body.code).toBe('FORBIDDEN');
  });
});
