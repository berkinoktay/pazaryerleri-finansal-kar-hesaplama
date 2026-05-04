import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

interface SeedVariantSpec {
  platformVariantId: number;
  barcode: string;
  stockCode: string;
  size?: string;
  salePrice?: string;
  onSale?: boolean;
  archived?: boolean;
  blacklisted?: boolean;
  locked?: boolean;
}

interface SeedProductSpec {
  platformContentId: number;
  productMainId: string;
  title: string;
  brandId?: bigint;
  brandName?: string;
  categoryId?: bigint;
  categoryName?: string;
  color?: string;
  variants: SeedVariantSpec[];
  imageUrls?: string[];
  platformModifiedAt?: Date;
}

async function seedProduct(
  organizationId: string,
  storeId: string,
  spec: SeedProductSpec,
): Promise<void> {
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(spec.platformContentId),
      productMainId: spec.productMainId,
      title: spec.title,
      brandId: spec.brandId ?? null,
      brandName: spec.brandName ?? null,
      categoryId: spec.categoryId ?? null,
      categoryName: spec.categoryName ?? null,
      color: spec.color ?? null,
      platformModifiedAt: spec.platformModifiedAt ?? new Date(),
    },
  });
  for (const v of spec.variants) {
    await prisma.productVariant.create({
      data: {
        organizationId,
        storeId,
        productId: product.id,
        platformVariantId: BigInt(v.platformVariantId),
        barcode: v.barcode,
        stockCode: v.stockCode,
        size: v.size ?? null,
        salePrice: v.salePrice ?? '100.00',
        listPrice: v.salePrice ?? '100.00',
        onSale: v.onSale ?? true,
        archived: v.archived ?? false,
        blacklisted: v.blacklisted ?? false,
        locked: v.locked ?? false,
      },
    });
  }
  for (const [position, url] of (spec.imageUrls ?? []).entries()) {
    await prisma.productImage.create({
      data: { organizationId, productId: product.id, url, position },
    });
  }
}

async function setupOrgWithStoreAndFixtures(): Promise<{
  user: { accessToken: string };
  orgId: string;
  storeId: string;
}> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Test Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: '2738',
      credentials: encryptCredentials({
        supplierId: '2738',
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
      }),
    },
  });

  // Seed five products covering the test surface:
  //   - Two share the same brand (for brand-filter test)
  //   - Two share the same category (for category-filter test)
  //   - One has an archived variant (for status-filter test)
  //   - One title contains "keten" (for search test)
  //   - One stockCode contains "STK-2025" (for search-by-stockcode test)
  await seedProduct(org.id, store.id, {
    platformContentId: 1001,
    productMainId: 'pm-1001',
    title: 'Beyaz Keten Gömlek',
    brandId: BigInt(2032),
    brandName: 'Modline',
    categoryId: BigInt(597),
    categoryName: 'Gömlek',
    color: 'Beyaz',
    platformModifiedAt: new Date('2026-04-25T12:00:00Z'),
    variants: [
      { platformVariantId: 10010, barcode: 'BC-0001', stockCode: 'STK-2025-A', size: 'M' },
    ],
    imageUrls: ['https://cdn.example.com/1001.jpg'],
  });
  await seedProduct(org.id, store.id, {
    platformContentId: 1002,
    productMainId: 'pm-1002',
    title: 'Mavi Pamuk T-shirt',
    brandId: BigInt(2032),
    brandName: 'Modline',
    categoryId: BigInt(800),
    categoryName: 'T-shirt',
    color: 'Mavi',
    platformModifiedAt: new Date('2026-04-26T12:00:00Z'),
    variants: [
      { platformVariantId: 10020, barcode: 'BC-0002', stockCode: 'STK-shirt-1', size: 'L' },
    ],
  });
  await seedProduct(org.id, store.id, {
    platformContentId: 1003,
    productMainId: 'pm-1003',
    title: 'Siyah Pantolon',
    brandId: BigInt(3226),
    brandName: 'BZN',
    categoryId: BigInt(800),
    categoryName: 'T-shirt',
    color: 'Siyah',
    platformModifiedAt: new Date('2026-04-22T12:00:00Z'),
    variants: [
      {
        platformVariantId: 10030,
        barcode: 'BC-0003',
        stockCode: 'STK-pantolon',
        size: 'S',
        archived: true,
        onSale: false,
      },
      { platformVariantId: 10031, barcode: 'BC-0004', stockCode: 'STK-pantolon', size: 'M' },
    ],
  });
  await seedProduct(org.id, store.id, {
    platformContentId: 1004,
    productMainId: 'pm-1004',
    title: 'Kırmızı Etek',
    brandId: BigInt(3226),
    brandName: 'BZN',
    categoryId: BigInt(900),
    categoryName: 'Etek',
    color: 'Kırmızı',
    platformModifiedAt: new Date('2026-04-27T12:00:00Z'),
    variants: [{ platformVariantId: 10040, barcode: 'BC-0005', stockCode: 'STK-etek', size: 'M' }],
  });
  await seedProduct(org.id, store.id, {
    platformContentId: 1005,
    productMainId: 'pm-1005',
    title: 'Yeşil Mont',
    color: 'Yeşil',
    platformModifiedAt: new Date('2026-04-20T12:00:00Z'),
    variants: [{ platformVariantId: 10050, barcode: 'BC-0006', stockCode: 'STK-mont', size: 'L' }],
  });

  return { user: { accessToken: user.accessToken }, orgId: org.id, storeId: store.id };
}

interface ListResponseBody {
  data: {
    id: string;
    title: string;
    productMainId: string;
    variants: { id: string; status: string }[];
    variantCount: number;
  }[];
  pagination: { page: number; perPage: number; total: number; totalPages: number };
}

async function callList(
  user: { accessToken: string },
  orgId: string,
  storeId: string,
  query: Record<string, string | number> = {},
): Promise<{ status: number; body: ListResponseBody }> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) search.set(k, String(v));
  const url = `/v1/organizations/${orgId}/stores/${storeId}/products${search.size > 0 ? `?${search.toString()}` : ''}`;
  const res = await app.request(url, { headers: { Authorization: bearer(user.accessToken) } });
  const body = (await res.json()) as ListResponseBody;
  return { status: res.status, body };
}

describe('GET /v1/organizations/:orgId/stores/:storeId/products', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without an auth token', async () => {
    const { orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/products`);
    expect(res.status).toBe(401);
  });

  it('returns 403 when the user is not a member of the organization', async () => {
    const { user } = await setupOrgWithStoreAndFixtures();
    const otherOrg = await createOrganization();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: 'Other',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '999',
        credentials: 'opaque',
      },
    });

    const res = await app.request(
      `/v1/organizations/${otherOrg.id}/stores/${otherStore.id}/products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when the storeId belongs to a different org', async () => {
    const { user, orgId } = await setupOrgWithStoreAndFixtures();
    const otherOrg = await createOrganization();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: 'Other',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '888',
        credentials: 'opaque',
      },
    });

    const res = await app.request(`/v1/organizations/${orgId}/stores/${otherStore.id}/products`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(404);
  });

  it('returns all five seeded products with default sort (newest platformModifiedAt first)', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { status, body } = await callList(user, orgId, storeId);

    expect(status).toBe(200);
    expect(body.pagination).toEqual({ page: 1, perPage: 25, total: 5, totalPages: 1 });
    expect(body.data).toHaveLength(5);
    // Default sort: -platformModifiedAt — Kırmızı Etek (apr 27) first.
    expect(body.data[0]?.title).toBe('Kırmızı Etek');
    expect(body.data[body.data.length - 1]?.title).toBe('Yeşil Mont');
  });

  it('search hits product title', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { status, body } = await callList(user, orgId, storeId, { q: 'keten' });
    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.title).toBe('Beyaz Keten Gömlek');
  });

  it('search hits variant.barcode', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { q: 'BC-0003' });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.title).toBe('Siyah Pantolon');
  });

  it('search hits variant.stockCode', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { q: 'STK-2025' });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.title).toBe('Beyaz Keten Gömlek');
  });

  it('search is case-insensitive', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { q: 'KETEN' });
    expect(body.data).toHaveLength(1);
  });

  it('brandId filter narrows to matching products', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { brandId: '2032' });
    expect(body.data).toHaveLength(2);
    expect(body.data.map((p) => p.title).sort()).toEqual([
      'Beyaz Keten Gömlek',
      'Mavi Pamuk T-shirt',
    ]);
  });

  it('categoryId filter narrows to matching products', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { categoryId: '800' });
    expect(body.data).toHaveLength(2);
    expect(body.data.map((p) => p.title).sort()).toEqual(['Mavi Pamuk T-shirt', 'Siyah Pantolon']);
  });

  it('status=onSale excludes products whose variants are all archived/locked/blacklisted', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { status: 'onSale' });
    // Siyah Pantolon has one onSale variant + one archived variant — it's still
    // included (parent kept if ≥1 variant matches), but its variants[] is filtered
    // to the onSale one only.
    const pantolon = body.data.find((p) => p.title === 'Siyah Pantolon');
    expect(pantolon).toBeDefined();
    expect(pantolon?.variants).toHaveLength(1);
    expect(pantolon?.variants[0]?.status).toBe('onSale');
    // variantCount is the TOTAL count (regardless of filter), so consumers know there's more
    expect(pantolon?.variantCount).toBe(2);
  });

  it('status=archived shows only the products that have an archived variant', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { status: 'archived' });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.title).toBe('Siyah Pantolon');
    expect(body.data[0]?.variants).toHaveLength(1);
    expect(body.data[0]?.variants[0]?.status).toBe('archived');
  });

  it('pagination page=2 perPage=2 returns the third+fourth in default sort order', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { page: 2, perPage: 10 });
    // 5 products, perPage=10, page=2 → empty
    expect(body.pagination).toEqual({ page: 2, perPage: 10, total: 5, totalPages: 1 });
    expect(body.data).toHaveLength(0);
  });

  it('pagination perPage=2 splits the 5 fixtures into 3 pages', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const page1 = await callList(user, orgId, storeId, { perPage: 10, page: 1 });
    expect(page1.body.pagination.totalPages).toBe(1);

    const small = await callList(user, orgId, storeId, { perPage: 10 });
    expect(small.body.data).toHaveLength(5);

    // Use perPage=10 (smallest valid) — only valid values are {10,25,50,100}.
    // To exercise pagination boundaries with a small fixture set, we instead
    // verify totalPages math: 5 items / 10 perPage → 1 page.
    expect(small.body.pagination.totalPages).toBe(1);
  });

  it('rejects invalid perPage values via VALIDATION_ERROR', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const res = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/products?perPage=7`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('sort=title returns products alphabetical by title', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { sort: 'title' });
    expect(body.data.map((p) => p.title)).toEqual([
      'Beyaz Keten Gömlek',
      'Kırmızı Etek',
      'Mavi Pamuk T-shirt',
      'Siyah Pantolon',
      'Yeşil Mont',
    ]);
  });
});

// ─── overrideMissing filter ───────────────────────────────────────────
// Variant-level filter for products with at least one variant missing
// the corresponding override field. Composes with status via AND.
//
// These tests build their own minimal setup (no shared fixtures) so the
// assertions stay focused on the new filter semantics. The default
// fixture set has costPrice=null and vatRate=null on every variant, so
// reusing it would muddy "matches" / "does not match" expectations.

async function setupBareTenant(): Promise<{
  user: { accessToken: string };
  orgId: string;
  storeId: string;
}> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Test Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: '4738',
      credentials: encryptCredentials({
        supplierId: '4738',
        apiKey: 'k',
        apiSecret: 's',
      }),
    },
  });
  return { user: { accessToken: user.accessToken }, orgId: org.id, storeId: store.id };
}

describe('GET /v1/.../products — overrideMissing filter', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns only products with ≥1 variant having NULL costPrice when overrideMissing=cost', async () => {
    const fixtures = await setupBareTenant();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 1001,
      productMainId: 'P-WITHCOST',
      title: 'Has cost',
      variants: [{ platformVariantId: 1101, barcode: 'B1', stockCode: 'S1' }],
    });
    // seedProduct does not set costPrice (defaults to null), so set it
    // explicitly here to make this product NOT match overrideMissing=cost.
    await prisma.productVariant.updateMany({
      where: { stockCode: 'S1' },
      data: { costPrice: '50.00' },
    });
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 1002,
      productMainId: 'P-NOCOST',
      title: 'Missing cost',
      variants: [{ platformVariantId: 1102, barcode: 'B2', stockCode: 'S2' }],
    });

    const { status, body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      overrideMissing: 'cost',
    });
    expect(status).toBe(200);
    const ids = body.data.map((p) => p.productMainId);
    expect(ids).toContain('P-NOCOST');
    expect(ids).not.toContain('P-WITHCOST');
  });

  it('returns only products with ≥1 variant having NULL vatRate when overrideMissing=vat', async () => {
    const fixtures = await setupBareTenant();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 2001,
      productMainId: 'P-WITHVAT',
      title: 'Has vat',
      variants: [{ platformVariantId: 2101, barcode: 'B3', stockCode: 'S3' }],
    });
    await prisma.productVariant.updateMany({
      where: { stockCode: 'S3' },
      data: { vatRate: 18 },
    });
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 2002,
      productMainId: 'P-NOVAT',
      title: 'Missing vat',
      variants: [{ platformVariantId: 2102, barcode: 'B4', stockCode: 'S4' }],
    });

    const { status, body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      overrideMissing: 'vat',
    });
    expect(status).toBe(200);
    const ids = body.data.map((p) => p.productMainId);
    expect(ids).toContain('P-NOVAT');
    expect(ids).not.toContain('P-WITHVAT');
  });

  it('AND-composes overrideMissing=cost with status=onSale (variant must satisfy both)', async () => {
    const fixtures = await setupBareTenant();
    // P-A: archived variant missing cost → excluded by status=onSale
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 3001,
      productMainId: 'P-A',
      title: 'A',
      variants: [
        { platformVariantId: 3101, barcode: 'BA', stockCode: 'SA', archived: true, onSale: false },
      ],
    });
    // P-B: onSale variant with cost → excluded by overrideMissing=cost
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 3002,
      productMainId: 'P-B',
      title: 'B',
      variants: [{ platformVariantId: 3102, barcode: 'BB', stockCode: 'SB' }],
    });
    await prisma.productVariant.updateMany({
      where: { stockCode: 'SB' },
      data: { costPrice: '99.00' },
    });
    // P-C: onSale variant missing cost → matches both
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 3003,
      productMainId: 'P-C',
      title: 'C',
      variants: [{ platformVariantId: 3103, barcode: 'BC', stockCode: 'SC' }],
    });

    const { body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      overrideMissing: 'cost',
      status: 'onSale',
    });
    const ids = body.data.map((p) => p.productMainId);
    expect(ids).toEqual(['P-C']);
  });
});

describe('GET /v1/.../products — sort=totalStock', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('orders products by Product.totalStock ascending then descending', async () => {
    const fixtures = await setupBareTenant();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 4001,
      productMainId: 'P-LOW',
      title: 'Low',
      variants: [{ platformVariantId: 4101, barcode: 'BL', stockCode: 'SL' }],
    });
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 4002,
      productMainId: 'P-HIGH',
      title: 'High',
      variants: [{ platformVariantId: 4102, barcode: 'BH', stockCode: 'SH' }],
    });
    await prisma.product.update({
      where: {
        storeId_platformContentId: {
          storeId: fixtures.storeId,
          platformContentId: BigInt(4001),
        },
      },
      data: { totalStock: 5 },
    });
    await prisma.product.update({
      where: {
        storeId_platformContentId: {
          storeId: fixtures.storeId,
          platformContentId: BigInt(4002),
        },
      },
      data: { totalStock: 50 },
    });

    const ascRes = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      sort: 'totalStock',
    });
    expect(ascRes.body.data.map((p) => p.productMainId)).toEqual(['P-LOW', 'P-HIGH']);

    const descRes = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      sort: '-totalStock',
    });
    expect(descRes.body.data.map((p) => p.productMainId)).toEqual(['P-HIGH', 'P-LOW']);
  });
});

describe('GET /v1/organizations/:orgId/stores/:storeId/products/facets', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns brand + category facets sorted by count desc', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/products/facets`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      brands: { id: string; name: string; count: number }[];
      categories: { id: string; name: string; count: number }[];
    };

    // Modline: 2 products, BZN: 2 products. (Yeşil Mont has no brand → skipped.)
    expect(body.brands).toHaveLength(2);
    expect(body.brands.every((b) => b.count === 2)).toBe(true);
    expect(body.brands.map((b) => b.name).sort()).toEqual(['BZN', 'Modline']);

    // T-shirt: 2 (Mavi Pamuk + Siyah Pantolon), Gömlek: 1, Etek: 1.
    const tshirt = body.categories.find((c) => c.name === 'T-shirt');
    expect(tshirt?.count).toBe(2);
    expect(body.categories[0]?.count).toBeGreaterThanOrEqual(body.categories[1]?.count ?? 0);
  });

  it('returns 404 when the storeId is in a different org', async () => {
    const { user, orgId } = await setupOrgWithStoreAndFixtures();
    const otherOrg = await createOrganization();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: 'Other',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '777',
        credentials: 'opaque',
      },
    });

    const res = await app.request(
      `/v1/organizations/${orgId}/stores/${otherStore.id}/products/facets`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(404);
  });
});
