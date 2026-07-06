// Route-layer authorization for the store-scoped plus-commission-tariffs endpoints
// (list / detail / delete / selections / estimate). The storeId in the path MUST
// belong to the caller's org, and a tariffId/itemId from another store must be
// indistinguishable from missing.
//
// SECURITY.md 3 - existence non-disclosure: a cross-org storeId or tariffId
// returns 404 (not 403), so an attacker cannot probe another tenant's ids. A
// non-member of the org gets 403; no token gets 401.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

/** Seed a minimal Plus tariff (one period, one item) for a store. Returns the tariff id. */
async function seedTariff(organizationId: string, storeId: string): Promise<string> {
  const tariff = await prisma.plusCommissionTariff.create({
    data: { organizationId, storeId, name: 'Org Plus Tariff' },
  });
  const period = await prisma.plusCommissionTariffPeriod.create({
    data: {
      organizationId,
      storeId,
      tariffId: tariff.id,
      dateRangeLabel: '30 Haziran - 7 Temmuz',
      sortOrder: 0,
    },
  });
  await prisma.plusCommissionTariffItem.create({
    data: {
      organizationId,
      storeId,
      periodId: period.id,
      barcode: 'BC-1',
      productTitle: 'Urun',
      currentPrice: '100.00',
      commissionBasePrice: '100.00',
      currentCommissionPct: '19',
      plusPriceUpperLimit: '90.00',
      plusCommissionPct: '15.4',
      plusCommissionBasePrice: '90.00',
      sortOrder: 0,
    },
  });
  return tariff.id;
}

describe('plus-commission-tariffs: route-layer authorization', () => {
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
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/plus-commission-tariffs`,
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
      `/v1/organizations/${org.id}/stores/${store.id}/plus-commission-tariffs`,
      { headers: { Authorization: bearer(outsider.accessToken) } },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('a request with no auth token returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/plus-commission-tariffs`,
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/plus-commission-tariffs`,
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/plus-commission-tariffs/${tariffB}`,
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/plus-commission-tariffs/${tariffB}`,
      { method: 'DELETE', headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);

    // The cross-tenant tariff must still exist in Org B.
    const stillThere = await prisma.plusCommissionTariff.findUnique({ where: { id: tariffB } });
    expect(stillThere).not.toBeNull();
  });

  it("Org A member saving selections on Org B's tariff via Org A's store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const tariffB = await seedTariff(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/plus-commission-tariffs/${tariffB}/selections`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: [{ itemId: crypto.randomUUID(), selected: true, customPrice: null }],
        }),
      },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a non-member saving selections returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);
    const tariff = await seedTariff(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/plus-commission-tariffs/${tariff}/selections`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(outsider.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          selections: [{ itemId: crypto.randomUUID(), selected: true, customPrice: null }],
        }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("Org A member estimating on Org B's tariff via Org A's store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const tariffB = await seedTariff(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/plus-commission-tariffs/${tariffB}/items/${crypto.randomUUID()}/estimate`,
      {
        method: 'POST',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: '100.00' }),
      },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a non-member estimating returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);
    const tariff = await seedTariff(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/plus-commission-tariffs/${tariff}/items/${crypto.randomUUID()}/estimate`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(outsider.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ price: '100.00' }),
      },
    );
    expect(res.status).toBe(403);
  });

  it('an estimate request with no auth token returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const tariff = await seedTariff(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/plus-commission-tariffs/${tariff}/items/${crypto.randomUUID()}/estimate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: '100.00' }),
      },
    );
    expect(res.status).toBe(401);
  });
});
