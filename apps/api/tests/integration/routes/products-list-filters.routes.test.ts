// Happy-path coverage for the Advanced Filtering query params on
// GET /products (PR-B2). salePrice range uses the denormalized min/max columns
// (PR-B1) as an interval-overlap test; stock is a totalStock range; vatRateIn is
// variant-level; brandIdIn/categoryIdIn are product-level multi-selects.

import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

interface ProductSpec {
  title: string;
  min: string;
  max: string;
  stock: number;
  brandId: bigint;
  categoryId: bigint;
  vatRate: number;
}

// min/max are the denormalized bounds; one variant per product carries the
// vatRate. Values picked so every filter has a non-trivial expected subset.
const PRODUCTS: ProductSpec[] = [
  {
    title: 'Cheap',
    min: '10.00',
    max: '30.00',
    stock: 5,
    brandId: 100n,
    categoryId: 10n,
    vatRate: 10,
  },
  {
    title: 'Mid',
    min: '40.00',
    max: '80.00',
    stock: 50,
    brandId: 200n,
    categoryId: 20n,
    vatRate: 20,
  },
  {
    title: 'Pricey',
    min: '100.00',
    max: '200.00',
    stock: 200,
    brandId: 100n,
    categoryId: 10n,
    vatRate: 1,
  },
  {
    title: 'Wide',
    min: '5.00',
    max: '500.00',
    stock: 0,
    brandId: 300n,
    categoryId: 30n,
    vatRate: 0,
  },
];

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
}

async function setup(): Promise<Ctx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  for (const [i, spec] of PRODUCTS.entries()) {
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(2000 + i),
        productMainId: `pm-${i.toString()}`,
        title: spec.title,
        brandId: spec.brandId,
        categoryId: spec.categoryId,
        minSalePrice: spec.min,
        maxSalePrice: spec.max,
        totalStock: spec.stock,
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: BigInt(20000 + i),
        barcode: `bc-${i.toString()}`,
        stockCode: `sk-${i.toString()}`,
        salePrice: spec.min,
        listPrice: spec.max,
        vatRate: spec.vatRate,
      },
    });
  }

  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

async function filteredTitles(ctx: Ctx, query: string): Promise<string[]> {
  const res = await app.request(
    `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/products?${query}`,
    { headers: { Authorization: bearer(ctx.accessToken) } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { title: string }[] };
  return body.data.map((p) => p.title).sort();
}

describe('GET /products — Advanced Filtering query params (PR-B2)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('salePriceMin matches products with a variant at or above the bound (maxSalePrice ≥ min)', async () => {
    const ctx = await setup();
    expect(await filteredTitles(ctx, 'salePriceMin=90')).toEqual(['Pricey', 'Wide']);
  });

  it('salePriceMax matches products with a variant at or below the bound (minSalePrice ≤ max)', async () => {
    const ctx = await setup();
    expect(await filteredTitles(ctx, 'salePriceMax=35')).toEqual(['Cheap', 'Wide']);
  });

  it('salePriceMin + salePriceMax is an interval-overlap test', async () => {
    const ctx = await setup();
    // [50,90]: Mid(40-80) overlaps, Wide(5-500) overlaps; Cheap(10-30) and
    // Pricey(100-200) do not.
    expect(await filteredTitles(ctx, 'salePriceMin=50&salePriceMax=90')).toEqual(['Mid', 'Wide']);
  });

  it('stockMin + stockMax bound totalStock inclusively', async () => {
    const ctx = await setup();
    expect(await filteredTitles(ctx, 'stockMin=50')).toEqual(['Mid', 'Pricey']);
    expect(await filteredTitles(ctx, 'stockMax=5')).toEqual(['Cheap', 'Wide']);
  });

  it('vatRateIn matches products with a variant carrying one of the rates', async () => {
    const ctx = await setup();
    expect(await filteredTitles(ctx, 'vatRateIn=10,20')).toEqual(['Cheap', 'Mid']);
  });

  it('brandIdIn matches any of the listed brand ids', async () => {
    const ctx = await setup();
    expect(await filteredTitles(ctx, 'brandIdIn=100,300')).toEqual(['Cheap', 'Pricey', 'Wide']);
  });

  it('categoryIdIn matches any of the listed category ids', async () => {
    const ctx = await setup();
    expect(await filteredTitles(ctx, 'categoryIdIn=20,30')).toEqual(['Mid', 'Wide']);
  });

  it('filters AND-combine across families', async () => {
    const ctx = await setup();
    // brand 100 AND stock ≥ 100 → only Pricey (Cheap is brand 100 but stock 5).
    expect(await filteredTitles(ctx, 'brandIdIn=100&stockMin=100')).toEqual(['Pricey']);
  });

  it('a blank multi-value param is rejected (422), not a silent match-nothing', async () => {
    const ctx = await setup();
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/products?brandIdIn=`,
      { headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(422);
  });
});
