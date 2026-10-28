// GET /products/facets: overrideCounts and the brand/category facets count
// products over the default listing scope (variants still in Trendyol's feed
// that are not ARCHIVED). "Missing cost" means no active (non-archived) cost
// profile is attached. "Missing desi" means no seller override and a synced
// (Trendyol) desi of 0. Every counter must equal the total of the matching
// list view, which is what the products page shows next to it.

import { prisma } from '@pazarsync/db';
import type { ProductVariantStatus } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createCostProfile,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';

const app = createApp();

interface VariantSpec {
  status?: ProductVariantStatus;
  delisted?: boolean;
  cost?: 'active' | 'archived';
  // Omitted: synced 0 and no override, the "missing desi" state.
  desi?: 'synced' | 'override' | 'override-zero';
}

// Desi columns written for each VariantSpec.desi value. An explicit override
// of 0 is the seller's choice, so it is not missing.
const DESI_COLUMNS: Record<
  NonNullable<VariantSpec['desi']>,
  { syncedDimensionalWeight: string; dimensionalWeightOverride: string | null }
> = {
  synced: { syncedDimensionalWeight: '2', dimensionalWeightOverride: null },
  override: { syncedDimensionalWeight: '0', dimensionalWeightOverride: '1.5' },
  'override-zero': { syncedDimensionalWeight: '0', dimensionalWeightOverride: '0' },
};

interface ProductSpec {
  key: string;
  brand?: { id: bigint; name: string };
  category?: { id: bigint; name: string };
  variants: VariantSpec[];
}

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
}

interface FacetsBody {
  brands: { id: string; name: string; count: number }[];
  categories: { id: string; name: string; count: number }[];
  overrideCounts: { missingCost: number; missingDesi: number; total: number };
}

const LIVE_BRAND = { id: 2032n, name: 'Live Brand' };
const GHOST_BRAND = { id: 9001n, name: 'Ghost Brand' };
const LIVE_CATEGORY = { id: 597n, name: 'Live Category' };
const GHOST_CATEGORY = { id: 9002n, name: 'Ghost Category' };

// total counts P1, P2, P3, P4 and P7 (each has an in-scope variant).
// missingCost counts P1, P3 (its only profile is archived) and P4 (its
// NOT_ON_SALE variant is in scope and cost-less). P5 and P6 have no in-scope
// variant at all, and P7's only cost-less variant is ARCHIVED.
// missingDesi counts P1 and P4 (its NOT_ON_SALE variant has no desi). P2 and
// P7 carry a synced desi, P3 an override and P4's first variant an override
// of 0; the desi-less variants of P5, P6 and P7 are out of scope.
const CATALOG: ProductSpec[] = [
  { key: 'P1-NO-COST', brand: LIVE_BRAND, category: LIVE_CATEGORY, variants: [{}] },
  { key: 'P2-COSTED', brand: LIVE_BRAND, variants: [{ cost: 'active', desi: 'synced' }] },
  { key: 'P3-ARCHIVED-PROFILE', variants: [{ cost: 'archived', desi: 'override' }] },
  {
    key: 'P4-CLOSED-NO-COST',
    variants: [{ cost: 'active', desi: 'override-zero' }, { status: 'NOT_ON_SALE' }],
  },
  {
    key: 'P5-ARCHIVED-ONLY',
    brand: GHOST_BRAND,
    category: GHOST_CATEGORY,
    variants: [{ status: 'ARCHIVED' }],
  },
  {
    key: 'P6-DELISTED-ONLY',
    brand: GHOST_BRAND,
    category: GHOST_CATEGORY,
    variants: [{ delisted: true }],
  },
  {
    key: 'P7-COSTED-PLUS-ARCHIVED',
    variants: [{ cost: 'active', desi: 'synced' }, { status: 'ARCHIVED' }],
  },
];

async function setup(): Promise<Ctx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

async function attachProfile(ctx: Ctx, variantId: string, archived: boolean): Promise<void> {
  const profile = await createCostProfile(ctx.orgId, { storeId: ctx.storeId });
  if (archived) {
    await prisma.costProfile.update({
      where: { id: profile.id },
      data: { archivedAt: new Date() },
    });
  }
  await prisma.productVariantCostProfile.create({
    data: { organizationId: ctx.orgId, productVariantId: variantId, profileId: profile.id },
  });
}

async function seedCatalog(ctx: Ctx, products: ProductSpec[]): Promise<void> {
  for (const [p, spec] of products.entries()) {
    const product = await prisma.product.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        platformContentId: BigInt(5000 + p),
        productMainId: spec.key,
        title: spec.key,
        brandId: spec.brand?.id ?? null,
        brandName: spec.brand?.name ?? null,
        categoryId: spec.category?.id ?? null,
        categoryName: spec.category?.name ?? null,
      },
    });
    for (const [v, variantSpec] of spec.variants.entries()) {
      const variant = await prisma.productVariant.create({
        data: {
          organizationId: ctx.orgId,
          storeId: ctx.storeId,
          productId: product.id,
          platformVariantId: BigInt(50000 + p * 10 + v),
          barcode: `${spec.key}-${v.toString()}`,
          stockCode: `${spec.key}-${v.toString()}`,
          salePrice: '10.00',
          listPrice: '10.00',
          status: variantSpec.status ?? 'ON_SALE',
          delistedAt: variantSpec.delisted === true ? new Date() : null,
          ...(variantSpec.desi !== undefined ? DESI_COLUMNS[variantSpec.desi] : {}),
        },
      });
      if (variantSpec.cost !== undefined) {
        await attachProfile(ctx, variant.id, variantSpec.cost === 'archived');
      }
    }
  }
}

async function getFacets(ctx: Ctx): Promise<{ status: number; body: FacetsBody }> {
  const res = await app.request(
    `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/products/facets`,
    { headers: { Authorization: bearer(ctx.accessToken) } },
  );
  return { status: res.status, body: (await res.json()) as FacetsBody };
}

async function getListTotal(ctx: Ctx, query: string): Promise<number> {
  const res = await app.request(
    `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/products${query}`,
    { headers: { Authorization: bearer(ctx.accessToken) } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { pagination: { total: number } };
  return body.pagination.total;
}

describe('GET /v1/.../products/facets: default listing scope', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('overrideCounts counts in-scope products and products with a cost-less or desi-less in-scope variant', async () => {
    const ctx = await setup();
    await seedCatalog(ctx, CATALOG);

    const { status, body } = await getFacets(ctx);

    expect(status).toBe(200);
    expect(body.overrideCounts).toEqual({ missingCost: 3, missingDesi: 2, total: 5 });
  });

  it('brand and category facets skip products with no in-scope variant', async () => {
    const ctx = await setup();
    await seedCatalog(ctx, CATALOG);

    const { body } = await getFacets(ctx);

    expect(body.brands).toEqual([{ id: '2032', name: 'Live Brand', count: 2 }]);
    expect(body.categories).toEqual([{ id: '597', name: 'Live Category', count: 1 }]);
  });

  it('total, missingCost and missingDesi equal the totals of the matching list views', async () => {
    const ctx = await setup();
    await seedCatalog(ctx, CATALOG);

    const { body } = await getFacets(ctx);

    expect(await getListTotal(ctx, '')).toBe(body.overrideCounts.total);
    expect(await getListTotal(ctx, '?overrideMissing=cost')).toBe(body.overrideCounts.missingCost);
    expect(await getListTotal(ctx, '?overrideMissing=desi')).toBe(body.overrideCounts.missingDesi);
  });

  it('the missing-cost banner, the cost tab badge and the cost tab list agree', async () => {
    const ctx = await setup();
    await seedCatalog(ctx, CATALOG);

    const { body: facetsBody } = await getFacets(ctx);
    const statsRes = await app.request(
      `/v1/organizations/${ctx.orgId}/products/missing-cost-stats`,
      { headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(statsRes.status).toBe(200);
    const stats = (await statsRes.json()) as {
      byStore: {
        storeId: string;
        missingCount: number;
        missingProductCount: number;
        totalVariants: number;
      }[];
    };
    const storeRow = stats.byStore.find((row) => row.storeId === ctx.storeId);

    // In scope: P1, P2, P3, both P4 variants and P7's costed variant (6).
    // Missing cost: P1, P3 (archived profile) and P4's NOT_ON_SALE variant (3),
    // one per product.
    expect(storeRow).toEqual({
      storeId: ctx.storeId,
      missingCount: 3,
      missingProductCount: 3,
      totalVariants: 6,
    });
    expect(facetsBody.overrideCounts.missingCost).toBe(storeRow?.missingProductCount);
    expect(await getListTotal(ctx, '?overrideMissing=cost')).toBe(storeRow?.missingProductCount);
  });
});
