// Route-layer authorization for GET /commission-rates. Commission rate rows
// are platform-scoped shared reference data, so "tenant isolation" here is
// not about hiding rows from cross-org peers (they all see the same set).
// What this file guards is the URL contract: the storeId in the path MUST
// belong to the caller's org, otherwise we return 404 (no existence leak).
// A second test pins the platform→rows wiring: passing a HEPSIBURADA store
// must NOT return the TRENDYOL tariff.

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

interface ListResponseWire {
  data: { id: string; platform: string; categoryName: string }[];
  meta: { hasMore: boolean };
}

describe('commission-rates list: route-layer authorization', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function seedRate(platform: 'TRENDYOL' | 'HEPSIBURADA', categoryId: number, name: string) {
    return prisma.marketplaceCommissionRate.create({
      data: {
        platform,
        ruleKind: 'CATEGORY',
        categoryId: BigInt(categoryId),
        brandId: null,
        categoryName: name,
        parentCategoryName: null,
        brandName: null,
        baseRate: new Decimal('5.00'),
        paymentTermDays: 60,
        segmentOverrides: {},
        fetchedAt: new Date(),
        sourceScreen: 'CategoryCommissionPaymentTerms',
      },
    });
  }

  // ─── Case 1: cross-org storeId returns 404 (no existence leak) ────────────

  it("Org A member calling Org B's storeId returns 404, not 200 + data", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    // Global rate exists — Org A would see it if their store URL were valid.
    await seedRate('TRENDYOL', 411, 'Casual Ayakkabı');

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/commission-rates?ruleKind=CATEGORY`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    // 404 instead of 200 with stale data, and instead of 403 which would leak
    // store existence. The store path doesn't match Org A's tenant boundary.
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  // ─── Case 2: rates are filtered by store.platform ─────────────────────────
  //
  // Pins the wiring: the rate query reads `platform` from the store, not from
  // a default constant. A HEPSIBURADA store's call must NOT surface TRENDYOL
  // rows, even though all authenticated users can read the global table.

  it('a HEPSIBURADA store returns only HEPSIBURADA rates, not TRENDYOL ones', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const hbStore = await createStore(org.id, { platform: 'HEPSIBURADA' });

    await seedRate('TRENDYOL', 411, 'TRENDYOL Casual Ayakkabı');
    await seedRate('HEPSIBURADA', 5001, 'HEPSIBURADA Ayakkabı');

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${hbStore.id}/commission-rates?ruleKind=CATEGORY`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.platform).toBe('HEPSIBURADA');
    expect(body.data[0]?.categoryName).toBe('HEPSIBURADA Ayakkabı');
  });
});
