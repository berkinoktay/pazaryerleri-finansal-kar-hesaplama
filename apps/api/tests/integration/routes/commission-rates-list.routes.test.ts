import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

// Wire-level shapes the tests assert on. Mirrors the validator's response
// schema closely enough to catch field renames without coupling to the full
// Zod inferred type.
interface ListItemWire {
  id: string;
  ruleKind: 'CATEGORY' | 'CATEGORY_BRAND';
  platform: 'TRENDYOL' | 'HEPSIBURADA';
  categoryId: string;
  brandId: string | null;
  categoryName: string;
  parentCategoryName: string | null;
  brandName: string | null;
  baseRate: string;
  paymentTermDays: number;
  segmentOverrides: Record<string, string>;
  productCount: number;
  fetchedAt: string;
}

interface ListResponseWire {
  data: ListItemWire[];
  pagination: { page: number; perPage: number; total: number; totalPages: number };
}

interface ProblemDetailsWire {
  code: string;
  status: number;
  errors?: { field: string; code: string; meta?: Record<string, unknown> }[];
}

describe('GET /v1/organizations/:orgId/stores/:storeId/commission-rates', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Seed helpers ─────────────────────────────────────────────────────────

  interface SeedRateSpec {
    ruleKind: 'CATEGORY' | 'CATEGORY_BRAND';
    categoryId: number;
    brandId?: number;
    categoryName?: string;
    parentCategoryName?: string;
    brandName?: string;
    baseRate?: string;
    paymentTermDays?: number;
    segmentOverrides?: Record<string, string>;
  }

  async function seedRate(spec: SeedRateSpec) {
    return prisma.marketplaceCommissionRate.create({
      data: {
        platform: 'TRENDYOL',
        ruleKind: spec.ruleKind,
        categoryId: BigInt(spec.categoryId),
        brandId: spec.brandId !== undefined ? BigInt(spec.brandId) : null,
        categoryName: spec.categoryName ?? 'Casual Ayakkabı',
        parentCategoryName:
          spec.ruleKind === 'CATEGORY' ? (spec.parentCategoryName ?? 'Günlük Ayakkabı') : null,
        brandName: spec.ruleKind === 'CATEGORY_BRAND' ? (spec.brandName ?? 'Reebok 10') : null,
        baseRate: new Decimal(spec.baseRate ?? '5.00'),
        paymentTermDays: spec.paymentTermDays ?? 60,
        segmentOverrides: spec.segmentOverrides ?? {},
        fetchedAt: new Date('2026-05-12T08:23:01.000Z'),
        sourceScreen:
          spec.ruleKind === 'CATEGORY'
            ? 'CategoryCommissionPaymentTerms'
            : 'CommercialRatesByCategoryAndBrand',
      },
    });
  }

  interface SeedProductSpec {
    categoryId: number;
    brandId?: number;
    approved?: boolean;
    variantArchived?: boolean;
  }

  async function seedProduct(orgId: string, storeId: string, spec: SeedProductSpec) {
    const product = await prisma.product.create({
      data: {
        organizationId: orgId,
        storeId,
        platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
        productMainId: `pmid-${randomUUID().slice(0, 8)}`,
        title: 'Test Product',
        brandId: spec.brandId !== undefined ? BigInt(spec.brandId) : null,
        categoryId: BigInt(spec.categoryId),
        approved: spec.approved ?? true,
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: orgId,
        storeId,
        productId: product.id,
        platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
        barcode: `BC-${randomUUID().slice(0, 8)}`,
        stockCode: `SC-${randomUUID().slice(0, 8)}`,
        salePrice: '100.00',
        listPrice: '100.00',
        archived: spec.variantArchived ?? false,
      },
    });
    return product;
  }

  async function setupOrgStore() {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    return { user, orgId: org.id, storeId: store.id };
  }

  function listUrl(
    orgId: string,
    storeId: string,
    qs: Record<string, string | number | undefined> = {},
  ): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qsStr = params.toString();
    return `/v1/organizations/${orgId}/stores/${storeId}/commission-rates${qsStr.length > 0 ? `?${qsStr}` : ''}`;
  }

  // ─── 1. Happy path: CATEGORY + productScope=all ───────────────────────────

  it('returns CATEGORY rows with default sort and pagination', async () => {
    const { user, orgId, storeId } = await setupOrgStore();
    await seedRate({
      ruleKind: 'CATEGORY',
      categoryId: 411,
      categoryName: 'Casual Ayakkabı',
      baseRate: '5.00',
    });
    await seedRate({
      ruleKind: 'CATEGORY',
      categoryId: 412,
      categoryName: 'Spor Ayakkabı',
      baseRate: '7.00',
    });

    const res = await app.request(listUrl(orgId, storeId, { ruleKind: 'CATEGORY' }), {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;
    expect(body.data).toHaveLength(2);
    // Sort: category_name:asc → "Casual Ayakkabı" before "Spor Ayakkabı"
    expect(body.data[0]?.categoryName).toBe('Casual Ayakkabı');
    expect(body.data[1]?.categoryName).toBe('Spor Ayakkabı');
    expect(body.data[0]?.ruleKind).toBe('CATEGORY');
    expect(body.data[0]?.brandId).toBeNull();
    expect(body.data[0]?.brandName).toBeNull();
    expect(body.data[0]?.parentCategoryName).toBe('Günlük Ayakkabı');
    expect(body.data[0]?.productCount).toBe(0);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.perPage).toBe(50);
    expect(body.pagination.total).toBeGreaterThanOrEqual(body.data.length);
    expect(body.pagination.totalPages).toBeGreaterThanOrEqual(1);
  });

  // ─── 2. ruleKind splits results ───────────────────────────────────────────

  it('returns only CATEGORY_BRAND rows when ruleKind is CATEGORY_BRAND', async () => {
    const { user, orgId, storeId } = await setupOrgStore();
    await seedRate({ ruleKind: 'CATEGORY', categoryId: 411 });
    await seedRate({
      ruleKind: 'CATEGORY_BRAND',
      categoryId: 411,
      brandId: 16,
      brandName: 'Reebok 10',
      baseRate: '4.00',
    });

    const res = await app.request(listUrl(orgId, storeId, { ruleKind: 'CATEGORY_BRAND' }), {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.ruleKind).toBe('CATEGORY_BRAND');
    expect(body.data[0]?.brandId).toBe('16');
    expect(body.data[0]?.brandName).toBe('Reebok 10');
    expect(body.data[0]?.parentCategoryName).toBeNull();
  });

  // ─── 3. q search in categoryName / parentCategoryName ─────────────────────

  it('matches q against categoryName (case-insensitive)', async () => {
    const { user, orgId, storeId } = await setupOrgStore();
    await seedRate({
      ruleKind: 'CATEGORY',
      categoryId: 411,
      categoryName: 'Casual Ayakkabı',
    });
    await seedRate({
      ruleKind: 'CATEGORY',
      categoryId: 412,
      categoryName: 'Spor Ayakkabı',
    });
    await seedRate({
      ruleKind: 'CATEGORY',
      categoryId: 413,
      categoryName: 'Bot',
      parentCategoryName: 'Erkek Ayakkabı',
    });

    const res = await app.request(
      listUrl(orgId, storeId, { ruleKind: 'CATEGORY', q: 'ayakkabı' }),
      {
        headers: { Authorization: bearer(user.accessToken) },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;
    // Matches: "Casual Ayakkabı" (category), "Spor Ayakkabı" (category), "Bot" (parent)
    expect(body.data).toHaveLength(3);
  });

  // ─── 4. q search in brandName ─────────────────────────────────────────────

  it('matches q against brandName on CATEGORY_BRAND rows', async () => {
    const { user, orgId, storeId } = await setupOrgStore();
    await seedRate({
      ruleKind: 'CATEGORY_BRAND',
      categoryId: 411,
      brandId: 16,
      brandName: 'Reebok 10',
    });
    await seedRate({
      ruleKind: 'CATEGORY_BRAND',
      categoryId: 411,
      brandId: 17,
      brandName: 'Nike Air',
    });

    const res = await app.request(
      listUrl(orgId, storeId, { ruleKind: 'CATEGORY_BRAND', q: 'reebok' }),
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.brandName).toBe('Reebok 10');
  });

  // ─── 5. productScope=active filters to categories with active products ────

  it('productScope=active returns only rates where the store has active products', async () => {
    const { user, orgId, storeId } = await setupOrgStore();
    await seedRate({ ruleKind: 'CATEGORY', categoryId: 411 });
    await seedRate({ ruleKind: 'CATEGORY', categoryId: 412 });
    await seedRate({ ruleKind: 'CATEGORY', categoryId: 413 });

    // Only category 411 has an active product
    await seedProduct(orgId, storeId, { categoryId: 411 });

    const res = await app.request(
      listUrl(orgId, storeId, { ruleKind: 'CATEGORY', productScope: 'active' }),
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.categoryId).toBe('411');
    expect(body.data[0]?.productCount).toBe(1);
  });

  // ─── 6. productScope=active with no active products → empty page ──────────

  it('returns an empty page when productScope=active and store has no active products', async () => {
    const { user, orgId, storeId } = await setupOrgStore();
    await seedRate({ ruleKind: 'CATEGORY', categoryId: 411 });

    const res = await app.request(
      listUrl(orgId, storeId, { ruleKind: 'CATEGORY', productScope: 'active' }),
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;
    expect(body.data).toEqual([]);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.totalPages).toBe(0);
  });

  // ─── 7. productCount excludes unapproved + variant-archived ───────────────

  it('productCount counts only approved products with at least one non-archived variant', async () => {
    const { user, orgId, storeId } = await setupOrgStore();
    await seedRate({ ruleKind: 'CATEGORY', categoryId: 411 });
    // 3 active (approved + variant.archived=false)
    await seedProduct(orgId, storeId, { categoryId: 411 });
    await seedProduct(orgId, storeId, { categoryId: 411 });
    await seedProduct(orgId, storeId, { categoryId: 411 });
    // 1 unapproved (excluded)
    await seedProduct(orgId, storeId, { categoryId: 411, approved: false });
    // 1 with variant archived (excluded — no non-archived variant)
    await seedProduct(orgId, storeId, { categoryId: 411, variantArchived: true });

    const res = await app.request(
      listUrl(orgId, storeId, { ruleKind: 'CATEGORY', productScope: 'all' }),
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.productCount).toBe(3);
  });

  // ─── 8. Page-based pagination ─────────────────────────────────────────────

  it('paginates with page=N and returns disjoint slices across pages', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id, { platform: 'TRENDYOL' });

    // Seed 30 CATEGORY rows so perPage=10 produces 3 pages
    for (let i = 0; i < 30; i++) {
      await seedRate({
        ruleKind: 'CATEGORY',
        categoryId: 1000 + i,
        categoryName: `Cat ${String(i).padStart(3, '0')}`,
      });
    }

    const reqPage = (page: number) =>
      app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/commission-rates?ruleKind=CATEGORY&page=${page}&perPage=10`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );

    const r1 = await reqPage(1);
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as ListResponseWire;
    expect(b1.data).toHaveLength(10);
    expect(b1.pagination).toEqual({ page: 1, perPage: 10, total: 30, totalPages: 3 });

    const r2 = await reqPage(2);
    const b2 = (await r2.json()) as ListResponseWire;
    expect(b2.data).toHaveLength(10);
    expect(b2.pagination.page).toBe(2);

    const r3 = await reqPage(3);
    const b3 = (await r3.json()) as ListResponseWire;
    expect(b3.data).toHaveLength(10);
    expect(b3.pagination.page).toBe(3);

    const ids = new Set<string>();
    for (const row of [...b1.data, ...b2.data, ...b3.data]) {
      expect(ids.has(row.id)).toBe(false);
      ids.add(row.id);
    }
    expect(ids.size).toBe(30);
  });

  // ─── 9. perPage outside locked set → 422 ─────────────────────────────────

  it('rejects perPage outside the locked set (e.g. 200) with 422 VALIDATION_ERROR', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id, { platform: 'TRENDYOL' });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/commission-rates?ruleKind=CATEGORY&perPage=200`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemDetailsWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors?.[0]?.field).toBe('perPage');
  });

  // ─── 10. sort=base_rate:desc ──────────────────────────────────────────────

  it('orders by base_rate desc when sort=base_rate:desc', async () => {
    const { user, orgId, storeId } = await setupOrgStore();
    await seedRate({ ruleKind: 'CATEGORY', categoryId: 411, baseRate: '5.00' });
    await seedRate({ ruleKind: 'CATEGORY', categoryId: 412, baseRate: '12.00' });
    await seedRate({ ruleKind: 'CATEGORY', categoryId: 413, baseRate: '8.00' });

    const res = await app.request(
      listUrl(orgId, storeId, { ruleKind: 'CATEGORY', sort: 'base_rate:desc' }),
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;
    expect(body.data.map((r) => r.baseRate)).toEqual(['12', '8', '5']);
  });

  // ─── 11. sort=product_count:desc + productScope=active ────────────────────

  it('orders by productCount desc when sort=product_count:desc + productScope=active', async () => {
    const { user, orgId, storeId } = await setupOrgStore();
    await seedRate({ ruleKind: 'CATEGORY', categoryId: 411 });
    await seedRate({ ruleKind: 'CATEGORY', categoryId: 412 });
    await seedRate({ ruleKind: 'CATEGORY', categoryId: 413 });

    // 5 active products in 411, 3 in 412, 1 in 413
    for (let i = 0; i < 5; i++) await seedProduct(orgId, storeId, { categoryId: 411 });
    for (let i = 0; i < 3; i++) await seedProduct(orgId, storeId, { categoryId: 412 });
    await seedProduct(orgId, storeId, { categoryId: 413 });

    const res = await app.request(
      listUrl(orgId, storeId, {
        ruleKind: 'CATEGORY',
        productScope: 'active',
        sort: 'product_count:desc',
      }),
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponseWire;
    expect(body.data.map((r) => r.productCount)).toEqual([5, 3, 1]);
  });

  // ─── 12. sort=product_count:desc + productScope=all → 422 ─────────────────

  it('rejects sort=product_count:desc with productScope=all (422 INVALID_SORT_FOR_SCOPE)', async () => {
    const { user, orgId, storeId } = await setupOrgStore();

    const res = await app.request(
      listUrl(orgId, storeId, {
        ruleKind: 'CATEGORY',
        productScope: 'all',
        sort: 'product_count:desc',
      }),
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemDetailsWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors?.[0]?.field).toBe('sort');
    expect(body.errors?.[0]?.code).toBe('INVALID_SORT_FOR_SCOPE');
  });

  // ─── 13. Store belongs to a different org → 404 ───────────────────────────

  it('returns 404 when the store belongs to a different organization', async () => {
    const { user, orgId } = await setupOrgStore();
    const otherOrg = await createOrganization();
    const otherStore = await createStore(otherOrg.id);

    const res = await app.request(listUrl(orgId, otherStore.id, { ruleKind: 'CATEGORY' }), {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ProblemDetailsWire;
    expect(body.code).toBe('NOT_FOUND');
  });

  // ─── Auth boundary checks ─────────────────────────────────────────────────

  it('returns 401 without a token', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const res = await app.request(listUrl(org.id, store.id, { ruleKind: 'CATEGORY' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller is not a member of the organization', async () => {
    const user = await createAuthenticatedTestUser();
    const otherOrg = await createOrganization();
    const otherStore = await createStore(otherOrg.id);

    const res = await app.request(listUrl(otherOrg.id, otherStore.id, { ruleKind: 'CATEGORY' }), {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(403);
  });
});
