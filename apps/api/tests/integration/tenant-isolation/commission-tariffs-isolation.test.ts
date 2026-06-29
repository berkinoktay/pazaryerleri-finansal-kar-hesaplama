// Route-layer authorization for the store-scoped commission-tariffs endpoints
// (list / detail / delete). The storeId in the path MUST belong to the caller's
// org, and a tariffId from another store must be indistinguishable from missing.
//
// SECURITY.md §3 — existence non-disclosure: a cross-org storeId or tariffId
// returns 404 (not 403), so an attacker cannot probe another tenant's ids. A
// non-member of the org gets 403; no token gets 401.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

/** Seed a minimal tariff (one period, one item) for a store. Returns the tariff id. */
async function seedTariff(organizationId: string, storeId: string): Promise<string> {
  const tariff = await prisma.commissionTariff.create({
    data: { organizationId, storeId, name: 'Org Tariff' },
  });
  const period = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId,
      storeId,
      tariffId: tariff.id,
      dateRangeLabel: '23 – 26 Haziran',
      sortOrder: 0,
    },
  });
  await prisma.commissionTariffItem.create({
    data: {
      organizationId,
      storeId,
      periodId: period.id,
      barcode: 'BC-1',
      productTitle: 'Ürün',
      currentPrice: '100.00',
      currentCommissionPct: '0.1900',
      bands: [{ key: 'band1', threshold: '100.00', commissionPct: '0.19' }],
    },
  });
  return tariff.id;
}

describe('commission-tariffs: route-layer authorization', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("Org A member listing Org B's storeId returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/commission-tariffs`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a non-member of the org returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs`,
      { headers: { Authorization: bearer(outsider.accessToken) } },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('a request with no auth token returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs`,
    );
    expect(res.status).toBe(401);
  });

  it("a member listing their own store never sees another org's tariffs", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    await seedTariff(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/commission-tariffs`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(0);
  });

  it("Org A member fetching Org B's tariff via Org A's store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const tariffB = await seedTariff(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/commission-tariffs/${tariffB}`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it("Org A member deleting Org B's tariff via Org A's store returns 404 and leaves it intact", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const tariffB = await seedTariff(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/commission-tariffs/${tariffB}`,
      { method: 'DELETE', headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);

    // The cross-tenant tariff must still exist in Org B.
    const stillThere = await prisma.commissionTariff.findUnique({ where: { id: tariffB } });
    expect(stillThere).not.toBeNull();
  });
});
