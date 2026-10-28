// Route-layer authorization for GET /commission-rates. Commission rate rows
// are platform-scoped shared reference data, so "tenant isolation" here is
// not about hiding rows from cross-org peers (they all see the same set).
// What this file guards is the URL contract: the storeId in the path MUST
// belong to the caller's org, otherwise we return 404 (no existence leak).
// A second test pins the platform→rows wiring: passing a HEPSIBURADA store
// must NOT return the TRENDYOL tariff. A third test pins the product counts:
// productCount and productScope=active read tenant Product rows, so they must
// only see the store in the URL, never another tenant's or a sibling store's.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createProductVariant,
  createStore,
} from '../../helpers/factories';

interface ListResponseWire {
  data: { id: string; platform: string; categoryName: string; productCount: number }[];
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

  // createProduct has no categoryId override, so the product row is written
  // inline; the variant comes from the shared factory (status defaults to
  // ON_SALE and delistedAt to null, so the product is inside the count scope).
  async function seedProductInCategory(orgId: string, storeId: string, categoryId: number) {
    const product = await prisma.product.create({
      data: {
        organizationId: orgId,
        storeId,
        platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
        productMainId: `pmid-${randomUUID().slice(0, 8)}`,
        title: 'Isolation Test Product',
        categoryId: BigInt(categoryId),
      },
    });
    await createProductVariant(orgId, storeId, product.id);
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

  // --- Product counts only see the store in the URL ---
  //
  // productCount and productScope=active are computed from Product rows, which
  // ARE tenant data. In-scope products in another tenant's store, or in a
  // sibling store of the same tenant, must never count toward the caller's store.

  it('productCount and productScope=active ignore products outside the store in the URL', async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);
    const siblingStoreA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    await seedRate('TRENDYOL', 411, 'Category 411');
    // In-scope products in category 411 exist only outside storeA.
    await seedProductInCategory(orgB.id, storeB.id, 411);
    await seedProductInCategory(orgA.id, siblingStoreA.id, 411);

    const headers = { Authorization: bearer(userA.accessToken) };
    const listUrl = (storeId: string, productScope: 'all' | 'active'): string =>
      `/v1/organizations/${orgA.id}/stores/${storeId}/commission-rates` +
      `?ruleKind=CATEGORY&productScope=${productScope}`;

    const allRes = await app.request(listUrl(storeA.id, 'all'), { headers });
    expect(allRes.status).toBe(200);
    const allBody = (await allRes.json()) as ListResponseWire;
    expect(allBody.data).toHaveLength(1);
    expect(allBody.data[0]?.productCount).toBe(0);

    const activeRes = await app.request(listUrl(storeA.id, 'active'), { headers });
    expect(activeRes.status).toBe(200);
    const activeBody = (await activeRes.json()) as ListResponseWire;
    expect(activeBody.data).toEqual([]);

    // Positive control: the sibling store counts its own product, so the zeros
    // above come from the store filter, not from the count rule.
    const siblingRes = await app.request(listUrl(siblingStoreA.id, 'all'), { headers });
    expect(siblingRes.status).toBe(200);
    const siblingBody = (await siblingRes.json()) as ListResponseWire;
    expect(siblingBody.data[0]?.productCount).toBe(1);
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
