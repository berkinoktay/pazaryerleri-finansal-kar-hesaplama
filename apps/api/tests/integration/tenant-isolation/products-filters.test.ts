// Multi-tenancy isolation for the Advanced Filtering query params on
// GET /products (PR-B2). docs/SECURITY.md §9: two orgs, both holding products
// that MATCH each filter, queried as one user — assert no filter leaks the
// other org's rows. The service anchors organizationId + storeId first; these
// prove every new filter rides that anchor.

import { prisma } from '@pazarsync/db';
import { ProductVariantStatus } from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

interface Tenant {
  accessToken: string;
  orgId: string;
  storeId: string;
}

// One product that matches every filter in FILTER_QUERIES, titled with the
// tenant tag so a leak is visible. It carries one variant per
// ProductVariantStatus plus a delisted one, so every status value (DELISTED
// included) matches it, and no variant has a cost profile, so the cost tab
// matches it too.
async function seedMatchingProduct(orgId: string, storeId: string, tag: string): Promise<void> {
  // A and B live under different stores, so the (storeId, platformContentId)
  // unique constraint lets both reuse the same fixed ids.
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: 9001n,
      productMainId: `pm-${tag}`,
      title: `${tag}-product`,
      brandId: 777n,
      categoryId: 888n,
      minSalePrice: '50.00',
      maxSalePrice: '150.00',
      totalStock: 42,
    },
  });
  const variants = [
    ...Object.values(ProductVariantStatus).map((status) => ({ status, delistedAt: null })),
    { status: ProductVariantStatus.ON_SALE, delistedAt: new Date() },
  ];
  for (const [index, variant] of variants.entries()) {
    await prisma.productVariant.create({
      data: {
        organizationId: orgId,
        storeId,
        productId: product.id,
        platformVariantId: 90010n + BigInt(index),
        barcode: `bc-${tag}-${index.toString()}`,
        stockCode: `sk-${tag}-${index.toString()}`,
        salePrice: '50.00',
        listPrice: '150.00',
        vatRate: 20,
        status: variant.status,
        delistedAt: variant.delistedAt,
      },
    });
  }
}

async function makeTenant(tag: string): Promise<Tenant> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  await seedMatchingProduct(org.id, store.id, tag);
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

// Every status value (DELISTED included) and the cost tab ride the same
// org + store anchor as the Advanced Filtering params.
const STATUS_FILTER_QUERIES = [...Object.values(ProductVariantStatus), 'DELISTED'].map(
  (status) => `status=${status}`,
);

const FILTER_QUERIES: readonly string[] = [
  'salePriceMin=40&salePriceMax=160',
  'stockMin=10&stockMax=100',
  'vatRateIn=20',
  'brandIdIn=777',
  'categoryIdIn=888',
  ...STATUS_FILTER_QUERIES,
  'overrideMissing=cost',
  'overrideMissing=cost&status=DELISTED',
];

describe('Tenant isolation — GET /products Advanced Filtering params', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('no filter param lets org B products surface in an org A store query', async () => {
    const a = await makeTenant('A');
    await makeTenant('B');

    for (const query of FILTER_QUERIES) {
      const res = await app.request(
        `/v1/organizations/${a.orgId}/stores/${a.storeId}/products?${query}`,
        { headers: { Authorization: bearer(a.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { title: string }[] };
      for (const product of body.data) {
        expect(product.title).toBe('A-product');
      }
      // And the A match is actually present (the filter isn't matching nothing).
      expect(body.data.map((p) => p.title)).toContain('A-product');
    }
  });

  it('cross-org path with a filter 404s (storeB under orgA) — no existence disclosure', async () => {
    const a = await makeTenant('A');
    const b = await makeTenant('B');

    const res = await app.request(
      `/v1/organizations/${a.orgId}/stores/${b.storeId}/products?brandIdIn=777`,
      { headers: { Authorization: bearer(a.accessToken) } },
    );
    expect(res.status).toBe(404);
  });

  it("cross-org path with a filter 403s when using org B's id with A's token", async () => {
    const a = await makeTenant('A');
    const b = await makeTenant('B');

    const res = await app.request(
      `/v1/organizations/${b.orgId}/stores/${b.storeId}/products?vatRateIn=20`,
      { headers: { Authorization: bearer(a.accessToken) } },
    );
    expect(res.status).toBe(403);
  });
});
