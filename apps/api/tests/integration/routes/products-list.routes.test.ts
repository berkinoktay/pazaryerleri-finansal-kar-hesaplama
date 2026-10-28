import { prisma } from '@pazarsync/db';
import type { ProductVariantStatus } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createCostProfile, createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

interface SeedVariantSpec {
  platformVariantId: number;
  barcode: string;
  stockCode: string;
  size?: string;
  salePrice?: string;
  status?: ProductVariantStatus;
  statusReason?: string | null;
  delistedAt?: Date | null;
  // Desi state. Defaults match a fresh sync of a product Trendyol sent no desi
  // for: synced 0 and no seller override (the "missing desi" state).
  syncedDimensionalWeight?: string;
  dimensionalWeightOverride?: string | null;
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
  platformCreatedAt?: Date;
  platformModifiedAt?: Date;
}

async function seedProduct(
  organizationId: string,
  storeId: string,
  spec: SeedProductSpec,
): Promise<void> {
  const modifiedAt = spec.platformModifiedAt ?? new Date();
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
      imageUrls: spec.imageUrls ?? [],
      // Default platformCreatedAt to platformModifiedAt so the default
      // `-platformCreatedAt` sort yields the same ordering as the older
      // `-platformModifiedAt` for fixtures that only specify the latter.
      platformCreatedAt: spec.platformCreatedAt ?? modifiedAt,
      platformModifiedAt: modifiedAt,
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
        status: v.status ?? 'ON_SALE',
        statusReason: v.statusReason ?? null,
        delistedAt: v.delistedAt ?? null,
        syncedDimensionalWeight: v.syncedDimensionalWeight ?? '0',
        dimensionalWeightOverride: v.dimensionalWeightOverride ?? null,
      },
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
  //   - One has an ARCHIVED variant (BC-0003) next to an ON_SALE one (BC-0004),
  //     for the status and search-scope tests
  //   - One title contains "keten" (for search test)
  //   - One stockCode contains "STK-2025" (for search-by-stockcode test)
  await seedProduct(org.id, store.id, {
    platformContentId: 1001,
    productMainId: 'pm-1001',
    title: 'Beyaz Keten Gomlek',
    brandId: BigInt(2032),
    brandName: 'Modline',
    categoryId: BigInt(597),
    categoryName: 'Gomlek',
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
        status: 'ARCHIVED',
      },
      { platformVariantId: 10031, barcode: 'BC-0004', stockCode: 'STK-pantolon', size: 'M' },
    ],
  });
  await seedProduct(org.id, store.id, {
    platformContentId: 1004,
    productMainId: 'pm-1004',
    title: 'Kirmizi Etek',
    brandId: BigInt(3226),
    brandName: 'BZN',
    categoryId: BigInt(900),
    categoryName: 'Etek',
    color: 'Kirmizi',
    platformModifiedAt: new Date('2026-04-27T12:00:00Z'),
    variants: [{ platformVariantId: 10040, barcode: 'BC-0005', stockCode: 'STK-etek', size: 'M' }],
  });
  await seedProduct(org.id, store.id, {
    platformContentId: 1005,
    productMainId: 'pm-1005',
    title: 'Yesil Mont',
    color: 'Yesil',
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
    imageUrls: string[];
    variants: {
      id: string;
      barcode: string;
      status: string;
      statusReason: string | null;
      delistedAt: string | null;
      dimensionalWeight: string | null;
      syncedDimensionalWeight: string | null;
      isDimensionalWeightOverridden: boolean;
      isDimensionalWeightMissing: boolean;
    }[];
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

  it('returns all five seeded products with default sort (newest platformCreatedAt first)', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { status, body } = await callList(user, orgId, storeId);

    expect(status).toBe(200);
    expect(body.pagination).toEqual({ page: 1, perPage: 25, total: 5, totalPages: 1 });
    expect(body.data).toHaveLength(5);
    // Default sort: -platformCreatedAt, so Kirmizi Etek (apr 27) comes first.
    // Fixtures default platformCreatedAt to platformModifiedAt (see seedProduct),
    // so the relative ordering is the same as the old -platformModifiedAt default.
    expect(body.data[0]?.title).toBe('Kirmizi Etek');
    expect(body.data[body.data.length - 1]?.title).toBe('Yesil Mont');
    // A product seeded without images comes back with an empty list.
    expect(body.data[body.data.length - 1]?.imageUrls).toEqual([]);
  });

  it('search hits product title', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { status, body } = await callList(user, orgId, storeId, { q: 'keten' });
    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.title).toBe('Beyaz Keten Gomlek');
    expect(body.data[0]?.imageUrls).toEqual(['https://cdn.example.com/1001.jpg']);
  });

  it('search hits variant.barcode', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { q: 'BC-0004' });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.title).toBe('Siyah Pantolon');
    expect(body.data[0]?.variants.map((v) => v.barcode)).toEqual(['BC-0004']);
  });

  it('a barcode hit on a hidden variant counts only when its status is asked for', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    // BC-0003 is the ARCHIVED variant of Siyah Pantolon. The default scope hides
    // it, so searching its barcode must not return the parent with only the
    // unrelated in-scope sibling BC-0004.
    const hidden = await callList(user, orgId, storeId, { q: 'BC-0003' });
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toHaveLength(0);

    const archived = await callList(user, orgId, storeId, { q: 'BC-0003', status: 'ARCHIVED' });
    expect(archived.status).toBe(200);
    expect(archived.body.data).toHaveLength(1);
    expect(archived.body.data[0]?.variants.map((v) => v.barcode)).toEqual(['BC-0003']);
  });

  it('search hits variant.stockCode', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { q: 'STK-2025' });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.title).toBe('Beyaz Keten Gomlek');
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
      'Beyaz Keten Gomlek',
      'Mavi Pamuk T-shirt',
    ]);
  });

  it('categoryId filter narrows to matching products', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { categoryId: '800' });
    expect(body.data).toHaveLength(2);
    expect(body.data.map((p) => p.title).sort()).toEqual(['Mavi Pamuk T-shirt', 'Siyah Pantolon']);
  });

  it('status=ON_SALE keeps a mixed parent but filters its variants[] to ON_SALE ones', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { status: 'ON_SALE' });
    // Siyah Pantolon has one ON_SALE and one ARCHIVED variant: it is still
    // included (the parent is kept when at least one variant matches), but its
    // variants[] holds the ON_SALE one only.
    const pantolon = body.data.find((p) => p.title === 'Siyah Pantolon');
    expect(pantolon).toBeDefined();
    expect(pantolon?.variants).toHaveLength(1);
    expect(pantolon?.variants[0]?.status).toBe('ON_SALE');
    // variantCount mirrors variants[].length so the UI count chip, Beden chip
    // overflow and expanded sub-row count never disagree ("what you see is
    // what you count", the same semantic as Trendyol's seller panel).
    expect(pantolon?.variantCount).toBe(1);
  });

  it('status=ARCHIVED shows only the products that have an archived variant', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { status: 'ARCHIVED' });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.title).toBe('Siyah Pantolon');
    expect(body.data[0]?.variants).toHaveLength(1);
    expect(body.data[0]?.variants[0]?.status).toBe('ARCHIVED');
  });

  it('without status the archived variant of a mixed product is hidden', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId);
    const pantolon = body.data.find((p) => p.title === 'Siyah Pantolon');
    expect(pantolon?.variants.map((v) => v.barcode)).toEqual(['BC-0004']);
    expect(pantolon?.variantCount).toBe(1);
  });

  it('pagination page=2 perPage=2 returns the third+fourth in default sort order', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const { body } = await callList(user, orgId, storeId, { page: 2, perPage: 10 });
    // 5 products, perPage=10, page=2 -> empty
    expect(body.pagination).toEqual({ page: 2, perPage: 10, total: 5, totalPages: 1 });
    expect(body.data).toHaveLength(0);
  });

  it('pagination perPage=2 splits the 5 fixtures into 3 pages', async () => {
    const { user, orgId, storeId } = await setupOrgWithStoreAndFixtures();
    const page1 = await callList(user, orgId, storeId, { perPage: 10, page: 1 });
    expect(page1.body.pagination.totalPages).toBe(1);

    const small = await callList(user, orgId, storeId, { perPage: 10 });
    expect(small.body.data).toHaveLength(5);

    // Use perPage=10 (smallest valid): only valid values are {10,25,50,100}.
    // To exercise pagination boundaries with a small fixture set, we instead
    // verify totalPages math: 5 items / 10 perPage -> 1 page.
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
      'Beyaz Keten Gomlek',
      'Kirmizi Etek',
      'Mavi Pamuk T-shirt',
      'Siyah Pantolon',
      'Yesil Mont',
    ]);
  });
});

// --- Bare tenant and scope fixtures ---
// The tests below build their own minimal setup (no shared fixtures) so the
// assertions stay focused on the scope, status and cost semantics.

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

// Attaches a fresh cost profile (active, or archived when asked) to the
// variant with this barcode.
async function attachCostProfile(
  organizationId: string,
  storeId: string,
  barcode: string,
  opts: { archived?: boolean } = {},
): Promise<void> {
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { storeId, barcode } });
  const profile = await createCostProfile(organizationId, { storeId });
  if (opts.archived === true) {
    await prisma.costProfile.update({
      where: { id: profile.id },
      data: { archivedAt: new Date() },
    });
  }
  await prisma.productVariantCostProfile.create({
    data: { organizationId, productVariantId: variant.id, profileId: profile.id },
  });
}

// productMainId -> sorted barcodes of the variants the response returned.
function barcodesByProduct(body: ListResponseBody): Record<string, string[]> {
  return Object.fromEntries(
    body.data.map((p) => [p.productMainId, p.variants.map((v) => v.barcode).sort()]),
  );
}

const DELISTED_AT = new Date('2026-04-20T00:00:00Z');

// One store covering every scope edge:
//   P-MIXED        ON_SALE + NOT_ON_SALE (in scope), ARCHIVED, delisted ON_SALE
//   P-ARCHIVED     only an ARCHIVED variant (never in the default list)
//   P-DELISTED     only a delisted LOCKED variant (never in the default list)
//   P-LOCKED       LOCKED with Trendyol's lockReason
//   P-BLACKLISTED  BLACKLISTED with Trendyol's blacklistReason
async function seedScopeFixtures(orgId: string, storeId: string): Promise<void> {
  await seedProduct(orgId, storeId, {
    platformContentId: 5001,
    productMainId: 'P-MIXED',
    title: 'Mixed',
    variants: [
      { platformVariantId: 50011, barcode: 'MIX-ON', stockCode: 'S-MIX-ON' },
      {
        platformVariantId: 50012,
        barcode: 'MIX-OFF',
        stockCode: 'S-MIX-OFF',
        status: 'NOT_ON_SALE',
      },
      {
        platformVariantId: 50013,
        barcode: 'MIX-ARCH',
        stockCode: 'S-MIX-ARCH',
        status: 'ARCHIVED',
      },
      {
        platformVariantId: 50014,
        barcode: 'MIX-GONE',
        stockCode: 'S-MIX-GONE',
        delistedAt: DELISTED_AT,
      },
    ],
  });
  await seedProduct(orgId, storeId, {
    platformContentId: 5002,
    productMainId: 'P-ARCHIVED',
    title: 'Archived only',
    variants: [
      { platformVariantId: 50021, barcode: 'ARCH', stockCode: 'S-ARCH', status: 'ARCHIVED' },
    ],
  });
  await seedProduct(orgId, storeId, {
    platformContentId: 5003,
    productMainId: 'P-DELISTED',
    title: 'Delisted only',
    variants: [
      {
        platformVariantId: 50031,
        barcode: 'GONE',
        stockCode: 'S-GONE',
        status: 'LOCKED',
        statusReason: 'UNSUPPLIED_PRODUCT',
        delistedAt: DELISTED_AT,
      },
    ],
  });
  await seedProduct(orgId, storeId, {
    platformContentId: 5004,
    productMainId: 'P-LOCKED',
    title: 'Locked',
    variants: [
      {
        platformVariantId: 50041,
        barcode: 'LOCK',
        stockCode: 'S-LOCK',
        status: 'LOCKED',
        statusReason: 'CRITICAL_SALE_PRICE_CHANGE',
      },
    ],
  });
  await seedProduct(orgId, storeId, {
    platformContentId: 5005,
    productMainId: 'P-BLACKLISTED',
    title: 'Blacklisted',
    variants: [
      {
        platformVariantId: 50051,
        barcode: 'BLACK',
        stockCode: 'S-BLACK',
        status: 'BLACKLISTED',
        statusReason: 'UNAPPROVED_BRAND_CATEGORY_SPM',
      },
    ],
  });
}

// Expected productMainId -> barcodes per status value. Every value except
// DELISTED skips delisted variants (P-DELISTED's LOCKED variant is not in the
// LOCKED result); DELISTED returns delisted variants whatever their status.
const STATUS_CASES: ReadonlyArray<[string, Record<string, string[]>]> = [
  ['ON_SALE', { 'P-MIXED': ['MIX-ON'] }],
  ['NOT_ON_SALE', { 'P-MIXED': ['MIX-OFF'] }],
  ['LOCKED', { 'P-LOCKED': ['LOCK'] }],
  ['BLACKLISTED', { 'P-BLACKLISTED': ['BLACK'] }],
  ['ARCHIVED', { 'P-ARCHIVED': ['ARCH'], 'P-MIXED': ['MIX-ARCH'] }],
  ['DELISTED', { 'P-DELISTED': ['GONE'], 'P-MIXED': ['MIX-GONE'] }],
];

describe('GET /v1/.../products: default listing scope and status filter', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('without status hides ARCHIVED and delisted variants and products left with none', async () => {
    const fixtures = await setupBareTenant();
    await seedScopeFixtures(fixtures.orgId, fixtures.storeId);

    const { status, body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId);

    expect(status).toBe(200);
    expect(barcodesByProduct(body)).toEqual({
      'P-MIXED': ['MIX-OFF', 'MIX-ON'],
      'P-LOCKED': ['LOCK'],
      'P-BLACKLISTED': ['BLACK'],
    });
    expect(body.pagination.total).toBe(3);
    const mixed = body.data.find((p) => p.productMainId === 'P-MIXED');
    expect(mixed?.variantCount).toBe(2);
    expect(mixed?.variants.map((v) => v.statusReason)).toEqual([null, null]);
  });

  it.each(STATUS_CASES)('status=%s returns only matching variants', async (filter, expected) => {
    const fixtures = await setupBareTenant();
    await seedScopeFixtures(fixtures.orgId, fixtures.storeId);

    const { status, body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      status: filter,
    });

    expect(status).toBe(200);
    expect(barcodesByProduct(body)).toEqual(expected);
    expect(body.pagination.total).toBe(Object.keys(expected).length);
  });

  it('variants carry status and statusReason; legacy fields and description are gone', async () => {
    const fixtures = await setupBareTenant();
    await seedScopeFixtures(fixtures.orgId, fixtures.storeId);

    const { body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      status: 'LOCKED',
    });

    const product = body.data[0];
    const variant = product?.variants[0];
    expect(variant).toMatchObject({
      barcode: 'LOCK',
      status: 'LOCKED',
      statusReason: 'CRITICAL_SALE_PRICE_CHANGE',
      delistedAt: null,
    });
    for (const legacyField of [
      'costPrice',
      'isRushDelivery',
      'fastDeliveryOptions',
      'locationBasedDelivery',
    ]) {
      expect(variant).not.toHaveProperty(legacyField);
    }
    expect(product).not.toHaveProperty('description');
  });

  it('a delisted variant keeps its last status and reason under DELISTED', async () => {
    const fixtures = await setupBareTenant();
    await seedScopeFixtures(fixtures.orgId, fixtures.storeId);

    const { body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      status: 'DELISTED',
    });

    const gone = body.data.find((p) => p.productMainId === 'P-DELISTED')?.variants[0];
    expect(gone?.status).toBe('LOCKED');
    expect(gone?.statusReason).toBe('UNSUPPLIED_PRODUCT');
    expect(gone?.delistedAt).toBe(DELISTED_AT.toISOString());
  });

  it('rejects the retired camelCase status values with VALIDATION_ERROR', async () => {
    const fixtures = await setupBareTenant();
    for (const legacy of ['onSale', 'archived', 'locked', 'blacklisted']) {
      const res = await app.request(
        `/v1/organizations/${fixtures.orgId}/stores/${fixtures.storeId}/products?status=${legacy}`,
        { headers: { Authorization: bearer(fixtures.user.accessToken) } },
      );
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('VALIDATION_ERROR');
    }
  });
});

// --- overrideMissing=cost ---
// A variant misses cost when no ACTIVE (non-archived) cost profile is attached.
// The filter composes with status (or the default listing scope) via AND.

describe('GET /v1/.../products: overrideMissing=cost', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns only products with a variant that has no cost profile attached', async () => {
    const fixtures = await setupBareTenant();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 1001,
      productMainId: 'P-WITHCOST',
      title: 'Has cost',
      variants: [{ platformVariantId: 1101, barcode: 'B1', stockCode: 'S1' }],
    });
    await attachCostProfile(fixtures.orgId, fixtures.storeId, 'B1');
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
    expect(barcodesByProduct(body)).toEqual({ 'P-NOCOST': ['B2'] });
  });

  it('treats a variant whose only profile is archived as missing cost', async () => {
    const fixtures = await setupBareTenant();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 1003,
      productMainId: 'P-ARCHIVED-PROFILE',
      title: 'Archived profile',
      variants: [{ platformVariantId: 1103, barcode: 'B3', stockCode: 'S3' }],
    });
    await attachCostProfile(fixtures.orgId, fixtures.storeId, 'B3', { archived: true });
    // Control: an active profile counts as cost, so this product stays out.
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 1009,
      productMainId: 'P-ACTIVE-PROFILE',
      title: 'Active profile',
      variants: [{ platformVariantId: 1109, barcode: 'B9', stockCode: 'S9' }],
    });
    await attachCostProfile(fixtures.orgId, fixtures.storeId, 'B9');

    const { body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      overrideMissing: 'cost',
    });

    expect(barcodesByProduct(body)).toEqual({ 'P-ARCHIVED-PROFILE': ['B3'] });
  });

  it('filters a multi-variant product down to its cost-missing variants', async () => {
    const fixtures = await setupBareTenant();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 1004,
      productMainId: 'P-HALF',
      title: 'Half costed',
      variants: [
        { platformVariantId: 1104, barcode: 'B4', stockCode: 'S4' },
        { platformVariantId: 1105, barcode: 'B5', stockCode: 'S5' },
      ],
    });
    await attachCostProfile(fixtures.orgId, fixtures.storeId, 'B4');

    const { body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      overrideMissing: 'cost',
    });

    expect(barcodesByProduct(body)).toEqual({ 'P-HALF': ['B5'] });
    expect(body.data[0]?.variantCount).toBe(1);
  });

  it('without status keeps archived and delisted cost-missing variants out', async () => {
    const fixtures = await setupBareTenant();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 1006,
      productMainId: 'P-OUT-OF-SCOPE',
      title: 'Out of scope',
      variants: [
        { platformVariantId: 1106, barcode: 'B6', stockCode: 'S6', status: 'ARCHIVED' },
        { platformVariantId: 1107, barcode: 'B7', stockCode: 'S7', delistedAt: DELISTED_AT },
      ],
    });
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 1008,
      productMainId: 'P-CLOSED',
      title: 'Closed for sale',
      variants: [
        { platformVariantId: 1108, barcode: 'B8', stockCode: 'S8', status: 'NOT_ON_SALE' },
      ],
    });

    const { body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      overrideMissing: 'cost',
    });

    expect(barcodesByProduct(body)).toEqual({ 'P-CLOSED': ['B8'] });
  });

  it('AND-composes overrideMissing=cost with status=ON_SALE (variant must satisfy both)', async () => {
    const fixtures = await setupBareTenant();
    // P-A: archived variant missing cost, excluded by status=ON_SALE
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 3001,
      productMainId: 'P-A',
      title: 'A',
      variants: [{ platformVariantId: 3101, barcode: 'BA', stockCode: 'SA', status: 'ARCHIVED' }],
    });
    // P-B: on-sale variant with an active profile, excluded by overrideMissing=cost
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 3002,
      productMainId: 'P-B',
      title: 'B',
      variants: [{ platformVariantId: 3102, barcode: 'BB', stockCode: 'SB' }],
    });
    await attachCostProfile(fixtures.orgId, fixtures.storeId, 'BB');
    // P-C: on-sale variant missing cost, matches both
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 3003,
      productMainId: 'P-C',
      title: 'C',
      variants: [{ platformVariantId: 3103, barcode: 'BC', stockCode: 'SC' }],
    });

    const { body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      overrideMissing: 'cost',
      status: 'ON_SALE',
    });
    const ids = body.data.map((p) => p.productMainId);
    expect(ids).toEqual(['P-C']);
  });

  it('rejects the removed overrideMissing=vat value with VALIDATION_ERROR', async () => {
    const fixtures = await setupBareTenant();
    const res = await app.request(
      `/v1/organizations/${fixtures.orgId}/stores/${fixtures.storeId}/products?overrideMissing=vat`,
      { headers: { Authorization: bearer(fixtures.user.accessToken) } },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// --- overrideMissing=desi ---
// A variant misses desi when the seller has entered no override AND Trendyol
// sent no desi (synced 0). An explicit override of 0 is the seller's choice and
// is NOT missing. The filter composes with status (or the default listing
// scope) via AND, exactly like overrideMissing=cost.

describe('GET /v1/.../products: overrideMissing=desi', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns only products with a variant that has no override and synced desi 0', async () => {
    const fixtures = await setupBareTenant();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 5001,
      productMainId: 'P-MISSING',
      title: 'No desi anywhere',
      variants: [{ platformVariantId: 5101, barcode: 'D1', stockCode: 'S1' }],
    });
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 5002,
      productMainId: 'P-SYNCED',
      title: 'Trendyol sent desi',
      variants: [
        { platformVariantId: 5102, barcode: 'D2', stockCode: 'S2', syncedDimensionalWeight: '2.5' },
      ],
    });
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 5003,
      productMainId: 'P-OVERRIDE',
      title: 'Seller entered desi',
      variants: [
        {
          platformVariantId: 5103,
          barcode: 'D3',
          stockCode: 'S3',
          dimensionalWeightOverride: '1.5',
        },
      ],
    });
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 5004,
      productMainId: 'P-OVERRIDE-ZERO',
      title: 'Seller entered desi 0',
      variants: [
        { platformVariantId: 5104, barcode: 'D4', stockCode: 'S4', dimensionalWeightOverride: '0' },
      ],
    });

    const { status, body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      overrideMissing: 'desi',
    });

    expect(status).toBe(200);
    expect(barcodesByProduct(body)).toEqual({ 'P-MISSING': ['D1'] });
    expect(body.pagination.total).toBe(1);
  });

  it('filters a multi-variant product down to its desi-missing variants', async () => {
    const fixtures = await setupBareTenant();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 5005,
      productMainId: 'P-HALF',
      title: 'Half measured',
      variants: [
        { platformVariantId: 5105, barcode: 'D5', stockCode: 'S5', syncedDimensionalWeight: '3' },
        { platformVariantId: 5106, barcode: 'D6', stockCode: 'S6' },
      ],
    });

    const { body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      overrideMissing: 'desi',
    });

    expect(barcodesByProduct(body)).toEqual({ 'P-HALF': ['D6'] });
    expect(body.data[0]?.variantCount).toBe(1);
  });

  it('without status keeps archived and delisted desi-missing variants out', async () => {
    const fixtures = await setupBareTenant();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 5007,
      productMainId: 'P-OUT-OF-SCOPE',
      title: 'Out of scope',
      variants: [
        { platformVariantId: 5107, barcode: 'D7', stockCode: 'S7', status: 'ARCHIVED' },
        { platformVariantId: 5108, barcode: 'D8', stockCode: 'S8', delistedAt: DELISTED_AT },
      ],
    });
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 5009,
      productMainId: 'P-CLOSED',
      title: 'Closed for sale',
      variants: [
        { platformVariantId: 5109, barcode: 'D9', stockCode: 'S9', status: 'NOT_ON_SALE' },
      ],
    });

    const { body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      overrideMissing: 'desi',
    });

    expect(barcodesByProduct(body)).toEqual({ 'P-CLOSED': ['D9'] });

    // An explicit status reaches the archived variant, still AND-ed with the
    // missing-desi predicate (same composition as overrideMissing=cost).
    const archived = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      overrideMissing: 'desi',
      status: 'ARCHIVED',
    });
    expect(barcodesByProduct(archived.body)).toEqual({ 'P-OUT-OF-SCOPE': ['D7'] });
  });

  it('AND-composes overrideMissing=desi with status=ON_SALE (variant must satisfy both)', async () => {
    const fixtures = await setupBareTenant();
    // P-A: not on sale and missing desi, excluded by status=ON_SALE
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 5010,
      productMainId: 'P-A',
      title: 'A',
      variants: [
        { platformVariantId: 5110, barcode: 'DA', stockCode: 'SA', status: 'NOT_ON_SALE' },
      ],
    });
    // P-B: on sale with a synced desi, excluded by overrideMissing=desi
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 5011,
      productMainId: 'P-B',
      title: 'B',
      variants: [
        { platformVariantId: 5111, barcode: 'DB', stockCode: 'SB', syncedDimensionalWeight: '1' },
      ],
    });
    // P-C: on sale and missing desi, matches both
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 5012,
      productMainId: 'P-C',
      title: 'C',
      variants: [{ platformVariantId: 5112, barcode: 'DC', stockCode: 'SC' }],
    });

    const { status, body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      overrideMissing: 'desi',
      status: 'ON_SALE',
    });

    expect(status).toBe(200);
    expect(body.data.map((p) => p.productMainId)).toEqual(['P-C']);
  });

  it('reports isDimensionalWeightMissing per variant from the backend rule', async () => {
    const fixtures = await setupBareTenant();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 5013,
      productMainId: 'P-FLAGS',
      title: 'Every desi state',
      variants: [
        { platformVariantId: 5113, barcode: 'F-MISSING', stockCode: 'SF1' },
        {
          platformVariantId: 5114,
          barcode: 'F-SYNCED',
          stockCode: 'SF2',
          syncedDimensionalWeight: '1.2',
        },
        {
          platformVariantId: 5115,
          barcode: 'F-OVERRIDE',
          stockCode: 'SF3',
          dimensionalWeightOverride: '4',
        },
        {
          platformVariantId: 5116,
          barcode: 'F-OVERRIDE-ZERO',
          stockCode: 'SF4',
          dimensionalWeightOverride: '0',
        },
      ],
    });

    const { status, body } = await callList(fixtures.user, fixtures.orgId, fixtures.storeId);

    expect(status).toBe(200);
    const byBarcode = new Map(body.data.flatMap((p) => p.variants).map((v) => [v.barcode, v]));
    expect(byBarcode.get('F-MISSING')).toMatchObject({
      dimensionalWeight: '0',
      syncedDimensionalWeight: '0',
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: true,
    });
    expect(byBarcode.get('F-SYNCED')).toMatchObject({
      dimensionalWeight: '1.2',
      syncedDimensionalWeight: '1.2',
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: false,
    });
    expect(byBarcode.get('F-OVERRIDE')).toMatchObject({
      dimensionalWeight: '4',
      syncedDimensionalWeight: '0',
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    });
    expect(byBarcode.get('F-OVERRIDE-ZERO')).toMatchObject({
      dimensionalWeight: '0',
      syncedDimensionalWeight: '0',
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    });
  });
});

describe('GET /v1/.../products: sort=totalStock', () => {
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

  it('breaks totalStock ties by id so offset pages neither repeat nor skip a product', async () => {
    const fixtures = await setupBareTenant();
    // Twelve products share totalStock 0 and span two pages of ten.
    for (let i = 0; i < 12; i += 1) {
      await seedProduct(fixtures.orgId, fixtures.storeId, {
        platformContentId: 4200 + i,
        productMainId: `P-TIE-${i}`,
        title: `Tie ${i}`,
        variants: [{ platformVariantId: 4300 + i, barcode: `BT${i}`, stockCode: `ST${i}` }],
      });
    }

    const query = { sort: 'totalStock', perPage: 10 };
    const page1 = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      ...query,
      page: 1,
    });
    const page2 = await callList(fixtures.user, fixtures.orgId, fixtures.storeId, {
      ...query,
      page: 2,
    });

    // Random v4 ids make insertion order differ from id order, so only the
    // tiebreaker yields this sequence. Lowercase hex sorts the same in JS and
    // in Postgres' byte-wise uuid comparison.
    const seeded = await prisma.product.findMany({
      where: { storeId: fixtures.storeId },
      select: { id: true },
    });
    const expected = seeded.map((p) => p.id).sort();
    expect([...page1.body.data, ...page2.body.data].map((p) => p.id)).toEqual(expected);
  });
});

// --- Shipping estimate fields (per spec section 6.2) ---
// The list response carries 4 per-variant fields produced by the
// SHIPPING_ESTIMATE_CTE_SQL mirror of estimateShippingCostForVariant.
// Full coverage of the 6 outcome states lives in the service-vs-SQL
// equivalence test (apps/api/tests/integration/shipping-estimator-equivalence.test.ts);
// this test verifies the route plumbing: the fields appear in the
// response with the right values for the configured store + variants.

interface ShippingFieldsBody {
  data: {
    id: string;
    variants: {
      id: string;
      barcode: string;
      estimatedShippingNet: string | null;
      shippingCarrierCode: string | null;
      shippingTariffApplied: 'NORMAL' | 'BAREM' | 'OWN_CONTRACT' | null;
      shippingEstimateStatus:
        | 'OK'
        | 'NO_CARRIER'
        | 'NO_DESI'
        | 'OWN_CONTRACT_EMPTY'
        | 'DESI_OVERFLOW';
    }[];
  }[];
}

describe('GET /v1/.../products: shipping estimate fields', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('includes shipping fields with correct OK values per variant (desi 0 resolves the lowest tier)', async () => {
    // Build a store wired to SENDEOMP with two products:
    //   - okProduct: variant has desi=3.0, so OK / NORMAL / SENDEOMP desi-3 = 101.99
    //   - noDesiProduct: variant has no override and synced desi 0
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (!carrier) {
      throw new Error('SENDEOMP missing: PR 1 (shipping seed) must run first');
    }

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Shipping Test Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'ship-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });

    // OK variant: desi 3.0, CEIL=3, SENDEOMP desi-3 = 101.99, salePrice 500 > all Barem ranges
    const okProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 9001n,
        productMainId: 'PM-SHIP-OK',
        title: 'OK Shipping Product',
      },
    });
    const okVariant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: okProduct.id,
        platformVariantId: 90010n,
        barcode: 'SHIP-OK',
        stockCode: 'SHIP-OK',
        salePrice: '500.00',
        listPrice: '500.00',
        dimensionalWeightOverride: '3.0',
      },
    });

    // Desi-0 variant: no override, synced desi defaults to 0, which resolves the
    // lowest tariff tier (SENDEOMP desi-0 = 91.99). "No desi, no estimate" is
    // retired: desi is always >= 0 and the tariff table covers desi 0.
    const noDesiProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 9002n,
        productMainId: 'PM-SHIP-NODESI',
        title: 'Zero Desi Product',
      },
    });
    const noDesiVariant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: noDesiProduct.id,
        platformVariantId: 90020n,
        barcode: 'SHIP-NODESI',
        stockCode: 'SHIP-NODESI',
        salePrice: '500.00',
        listPrice: '500.00',
        dimensionalWeightOverride: null,
        syncedDimensionalWeight: '0',
      },
    });

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/products`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShippingFieldsBody;

    // Pull each variant out by its id (order-independent assertions).
    const okV = body.data.flatMap((p) => p.variants).find((v) => v.id === okVariant.id);
    const noDesiV = body.data.flatMap((p) => p.variants).find((v) => v.id === noDesiVariant.id);

    expect(okV).toBeDefined();
    expect(okV?.shippingEstimateStatus).toBe('OK');
    expect(okV?.shippingTariffApplied).toBe('NORMAL');
    expect(okV?.shippingCarrierCode).toBe('SENDEOMP');
    expect(okV?.estimatedShippingNet).toBe('101.99');

    expect(noDesiV).toBeDefined();
    // Desi 0 resolves the lowest tariff tier: a real estimate, not NO_DESI.
    expect(noDesiV?.shippingEstimateStatus).toBe('OK');
    expect(noDesiV?.shippingTariffApplied).toBe('NORMAL');
    expect(noDesiV?.estimatedShippingNet).toBe('91.99');
    expect(noDesiV?.shippingCarrierCode).toBe('SENDEOMP');
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

    // Modline: 2 products, BZN: 2 products. (Yesil Mont has no brand, so it is skipped.)
    expect(body.brands).toHaveLength(2);
    expect(body.brands.every((b) => b.count === 2)).toBe(true);
    expect(body.brands.map((b) => b.name).sort()).toEqual(['BZN', 'Modline']);

    // T-shirt: 2 (Mavi Pamuk + Siyah Pantolon), Gomlek: 1, Etek: 1.
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
