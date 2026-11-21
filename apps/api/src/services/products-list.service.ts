// Read-side counterpart to ProductSyncService. Pure DB reads scoped to
// (orgId, storeId), with the four filters (q / status / brandId /
// categoryId) and 1-indexed offset pagination. Status filtering happens
// at the variant level so the parent's `variants[]` array is filtered
// to matching variants — but the parent itself is included whenever
// ≥1 of its variants matches.

import { Decimal } from 'decimal.js';

import { LISTED_VARIANT_WHERE } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import type { Prisma } from '@pazarsync/db';

import { enumInWhere, rangeWhere } from '../lib/where-builders';
import { SHIPPING_ESTIMATE_CTE_SQL, type ShippingEstimateRow } from './shipping-estimator.sql';
import type {
  CostStatus,
  ListProductsQuery,
  ProductListSort,
  ProductListStatusFilter,
  ProductOverrideMissing,
  VariantCostAggregate,
  VariantShippingEstimate,
} from '../validators/product.validator';
import {
  DELISTED_STATUS_FILTER,
  toProductWithVariantsResponse,
  type ListProductsResponseSchema,
  type ProductFacetsResponseSchema,
} from '../validators/product.validator';
import type { z } from '@hono/zod-openapi';

type ListResponse = z.infer<typeof ListProductsResponseSchema>;
type FacetsResponse = z.infer<typeof ProductFacetsResponseSchema>;

// ─── Where-clause builders ─────────────────────────────────────────────

// A variant "misses cost" when no ACTIVE (non-archived) cost profile is
// attached. One predicate for the overrideMissing=cost list, the facets
// missingCost badge and the missing-cost stats, so the three always agree.
const MISSING_COST_VARIANT_WHERE = {
  costProfileLinks: { none: { profile: { archivedAt: null } } },
} satisfies Prisma.ProductVariantWhereInput;

// A variant "misses desi" when the seller entered no override and Trendyol sent
// no desi (the catalog mapper stores an absent value as 0). An explicit override
// of 0 is the seller's choice and is NOT missing. One predicate for the
// overrideMissing=desi list and the facets missingDesi badge, so the two always
// agree; toVariantDesiFields (product.validator.ts) applies the same rule to
// each variant as isDimensionalWeightMissing.
const MISSING_DESI_VARIANT_WHERE = {
  dimensionalWeightOverride: null,
  syncedDimensionalWeight: 0,
} satisfies Prisma.ProductVariantWhereInput;

function variantStatusWhere(status: ProductListStatusFilter): Prisma.ProductVariantWhereInput {
  // DELISTED ignores the status column (a delisted variant keeps its last
  // status); every other value is "that status AND still listed", so the six
  // filter values never overlap.
  if (status === DELISTED_STATUS_FILTER) {
    return { delistedAt: { not: null } };
  }
  return { status, delistedAt: null };
}

function variantOverrideMissingWhere(
  missing: ProductOverrideMissing,
): Prisma.ProductVariantWhereInput {
  switch (missing) {
    case 'cost':
      return MISSING_COST_VARIANT_WHERE;
    case 'desi':
      return MISSING_DESI_VARIANT_WHERE;
    default: {
      const _exhaustive: never = missing;
      throw new Error(`Unhandled overrideMissing filter: ${String(_exhaustive)}`);
    }
  }
}

// Search hits the product title or productMainId, or the barcode / stockCode of
// a variant that also passes the variant-level filters. Scoping the variant
// side to `variantWhere` keeps a hit on a hidden variant (for example an
// ARCHIVED one under the default listing scope) from returning its parent
// without the matching variant in variants[].
function buildSearchWhere(
  q: string,
  variantWhere: Prisma.ProductVariantWhereInput,
): Prisma.ProductWhereInput {
  return {
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { productMainId: { contains: q, mode: 'insensitive' } },
      {
        variants: {
          some: { AND: [variantWhere, { barcode: { contains: q, mode: 'insensitive' } }] },
        },
      },
      {
        variants: {
          some: { AND: [variantWhere, { stockCode: { contains: q, mode: 'insensitive' } }] },
        },
      },
    ],
  };
}

function buildOrderBy(sort: ProductListSort): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case '-platformCreatedAt':
      // Default. NULL platformCreatedAt rows (legacy syncs from before the
      // column was populated) sort to the end so they don't pollute the top.
      return { platformCreatedAt: { sort: 'desc', nulls: 'last' } };
    case 'platformCreatedAt':
      return { platformCreatedAt: { sort: 'asc', nulls: 'last' } };
    case '-platformModifiedAt':
      return { platformModifiedAt: 'desc' };
    case 'platformModifiedAt':
      return { platformModifiedAt: 'asc' };
    case 'title':
      return { title: 'asc' };
    case '-title':
      return { title: 'desc' };
    case 'salePrice':
      // Ascending = "cheapest products first" → order by the product's lowest
      // variant price (its "from ₺X" representative at the cheap end).
      return { minSalePrice: { sort: 'asc', nulls: 'last' } };
    case '-salePrice':
      // Descending = "priciest products first" → order by the product's highest
      // variant price. Intentionally NOT a strict reverse of the asc case: a
      // multi-variant product has no single price, so each direction surfaces
      // the extreme the seller means. Both columns (like totalStock) cover
      // only the variants in the default listing scope and are maintained by
      // refreshProductAggregates in @pazarsync/catalog-sync.
      return { maxSalePrice: { sort: 'desc', nulls: 'last' } };
    case 'totalStock':
      return { totalStock: 'asc' };
    case '-totalStock':
      return { totalStock: 'desc' };
  }
}

// ─── List ──────────────────────────────────────────────────────────────

export async function list(opts: {
  organizationId: string;
  storeId: string;
  filters: ListProductsQuery;
}): Promise<ListResponse> {
  const { organizationId, storeId, filters } = opts;

  // Variant-level filters compose with AND: the status (or, without one, the
  // default listing scope), overrideMissing and vatRateIn. The parent is
  // included if at least one variant matches them all, and the response
  // variants[] holds exactly those variants, so the scope always applies.
  const variantConditions: Prisma.ProductVariantWhereInput[] = [
    filters.status !== undefined ? variantStatusWhere(filters.status) : LISTED_VARIANT_WHERE,
  ];
  if (filters.overrideMissing !== undefined) {
    variantConditions.push(variantOverrideMissingWhere(filters.overrideMissing));
  }
  // vatRateIn (Advanced Filtering) is variant-level too: a product matches when
  // ≥1 variant carries one of the listed rates — composes with status/override
  // via the same AND of variant conditions.
  const vatRateIn = enumInWhere(filters.vatRateIn);
  if (vatRateIn !== undefined) {
    variantConditions.push({ vatRate: vatRateIn });
  }
  const variantWhere: Prisma.ProductVariantWhereInput = { AND: variantConditions };

  const productWhere: Prisma.ProductWhereInput = {
    organizationId,
    storeId,
    ...(filters.productId !== undefined ? { id: filters.productId } : {}),
    variants: { some: variantWhere },
    ...(filters.q !== undefined ? buildSearchWhere(filters.q, variantWhere) : {}),
  };

  // brandId / categoryId: the advanced multi-select (`*In`) wins when present,
  // otherwise the existing single-value facet param applies. Both map to the
  // same Prisma field, so one `??` picks the active one and we assign only when
  // a filter is actually set.
  const brandFilter = enumInWhere(filters.brandIdIn) ?? filters.brandId;
  if (brandFilter !== undefined) productWhere.brandId = brandFilter;

  const categoryFilter = enumInWhere(filters.categoryIdIn) ?? filters.categoryId;
  if (categoryFilter !== undefined) productWhere.categoryId = categoryFilter;

  // salePrice overlap via the denormalized B1 columns (PR-B1): a product's price
  // interval [minSalePrice, maxSalePrice] overlaps the requested [min, max] iff
  // maxSalePrice >= min AND minSalePrice <= max. Each bound maps to one column,
  // so gte-only / lte-only / between all fall out naturally. Decimal columns
  // accept decimal-string bounds — Postgres compares them numerically.
  if (filters.salePriceMin !== undefined) {
    productWhere.maxSalePrice = { gte: filters.salePriceMin };
  }
  if (filters.salePriceMax !== undefined) {
    productWhere.minSalePrice = { lte: filters.salePriceMax };
  }

  // totalStock range via the shared builder.
  const stockRange = rangeWhere(filters.stockMin, filters.stockMax);
  if (stockRange !== undefined) {
    productWhere.totalStock = stockRange;
  }

  const skip = (filters.page - 1) * filters.perPage;

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where: productWhere,
      include: {
        // Same predicate as the parent filter, so variants[] holds exactly the
        // matching variants (the contract on ListProductsQuerySchema). No
        // `_count`: variantCount is derived from variants.length in the mapper,
        // so the count chip, Beden chips and expanded sub-rows never disagree.
        variants: { where: variantWhere },
      },
      // id breaks ties so offset pages never repeat or skip a product: in the
      // ARCHIVED and DELISTED views many products share totalStock 0 and null
      // price bounds.
      orderBy: [buildOrderBy(filters.sort), { id: 'asc' }],
      take: filters.perPage,
      skip,
    }),
    prisma.product.count({ where: productWhere }),
  ]);

  // Collect all variant IDs from this page and run the cost aggregate
  // in a single raw-SQL query. Results are keyed by variant id for O(1)
  // lookup in the mapper.
  //
  // The shipping aggregate runs in parallel — it's the raw-SQL mirror of
  // `estimateShippingCostForVariant`. The CTE is constrained to the current
  // (organizationId, storeId) so the scan matches the page's tenant scope
  // exactly (the products list endpoint is always store-scoped). Map keyed
  // by variantId so the mapper can drop entries outside the current page
  // in O(1). Both queries are independent of each other so `Promise.all`
  // keeps the wall time at max(cost, shipping) rather than serializing.
  const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const [costByVariantId, shippingByVariantId] = await Promise.all([
    fetchCostAggregates(organizationId, variantIds),
    fetchShippingEstimates(organizationId, storeId),
  ]);

  const totalPages = total === 0 ? 0 : Math.ceil(total / filters.perPage);

  return {
    data: products.map((product) =>
      toProductWithVariantsResponse(product, costByVariantId, shippingByVariantId),
    ),
    pagination: {
      page: filters.page,
      perPage: filters.perPage,
      total,
      totalPages,
    },
  };
}

// ─── Shipping estimate aggregate ───────────────────────────────────────
// Raw SQL via `SHIPPING_ESTIMATE_CTE_SQL` — the mirror of the canonical
// service function `estimateShippingCostForVariant`. The CTE filters on
// `(pv.organization_id, pv.store_id)` and returns one row per variant in
// that scope; we Map by id for O(1) lookup. Equivalence test:
//   apps/api/tests/integration/shipping-estimator-equivalence.test.ts

async function fetchShippingEstimates(
  organizationId: string,
  storeId: string,
): Promise<Map<string, VariantShippingEstimate>> {
  // $3: price with the default carrier's tariff version in force now, the same
  // instant the canonical service function reads.
  const rows = await prisma.$queryRawUnsafe<ShippingEstimateRow[]>(
    SHIPPING_ESTIMATE_CTE_SQL,
    organizationId,
    storeId,
    new Date().toISOString(),
  );

  const result = new Map<string, VariantShippingEstimate>();
  for (const row of rows) {
    result.set(row.id, {
      estimatedShippingNet: row.estimated_shipping_net,
      shippingCarrierCode: row.shipping_carrier_code,
      shippingTariffApplied: row.shipping_tariff_applied,
      shippingEstimateStatus: row.shipping_estimate_status,
    });
  }
  return result;
}

// ─── Cost aggregate ────────────────────────────────────────────────────
// Raw SQL: the plain TL sum of the active (non-archived) cost profiles
// attached to each variant. The result is a flat list keyed by variant_id;
// the caller builds a Map<id, VariantCostAggregate> for O(1) lookup in the
// mapper. Status is OK when the variant has ≥1 profile, NO_PROFILES otherwise.

interface CostAggregateRow {
  variant_id: string;
  current_cost_try: unknown; // Decimal from PG — coerce below
  profile_count: bigint; // Prisma $queryRaw returns bigint for COUNT
}

function deriveCostStatus(profileCount: number): CostStatus {
  return profileCount === 0 ? 'NO_PROFILES' : 'OK';
}

export async function fetchCostAggregates(
  organizationId: string,
  variantIds: string[],
): Promise<Map<string, VariantCostAggregate>> {
  if (variantIds.length === 0) return new Map();

  // Cast to uuid[] so Postgres can match against the typed column.
  const rows = await prisma.$queryRaw<CostAggregateRow[]>`
    SELECT
      pv.id                                             AS variant_id,
      COALESCE(SUM(cp.amount_gross), 0)::DECIMAL(12,2)  AS current_cost_try,
      COUNT(cp.id)                                      AS profile_count
    FROM product_variants pv
    LEFT JOIN product_variant_cost_profiles pvcp
      ON pvcp.product_variant_id = pv.id
    LEFT JOIN cost_profiles cp
      ON cp.id = pvcp.profile_id AND cp.archived_at IS NULL
    WHERE pv.id = ANY(${variantIds}::uuid[])
      AND pv.organization_id = ${organizationId}::uuid
    GROUP BY pv.id
  `;

  const result = new Map<string, VariantCostAggregate>();
  for (const row of rows) {
    const profileCount = Number(row.profile_count);
    const costStatus = deriveCostStatus(profileCount);
    const rawCost = row.current_cost_try;
    const costDecimal =
      rawCost !== null && rawCost !== undefined ? new Decimal(String(rawCost)) : new Decimal(0);
    result.set(row.variant_id, {
      currentCostTry: profileCount > 0 ? costDecimal.toFixed(2) : null,
      profileCount,
      costStatus,
    });
  }
  return result;
}

// ─── Missing-cost stats ────────────────────────────────────────────────

export interface MissingCostStats {
  count: number;
  missingProductCount: number;
  totalVariants: number;
  byStore: {
    storeId: string;
    missingCount: number;
    missingProductCount: number;
    totalVariants: number;
  }[];
}

/**
 * Org-wide missing-cost stats over the default listing scope, narrowed to the
 * caller's accessible stores.
 *
 * Only variants in LISTED_VARIANT_WHERE (still in Trendyol's feed, not
 * ARCHIVED) are counted, and "missing" uses the same predicate as the
 * overrideMissing=cost list, so the banner, the tab badge and the tab content
 * agree. `missingProductCount` counts each product once, however many of its
 * in-scope variants miss cost.
 *
 * `storeIds` is `null` for OWNER/ADMIN (every store in the org) or the granted
 * store-id list for MEMBER/VIEWER. Without this narrowing a member restricted to
 * store A could enumerate every store id in the org plus each store's catalog
 * size and cost-coverage counts, data the store-scoped endpoints (and the
 * product_variants RLS) deliberately hide from them. An empty granted list
 * (member with no grants) matches nothing: zero counts and an empty byStore.
 */
export async function missingCostStats(
  organizationId: string,
  storeIds: string[] | null,
): Promise<MissingCostStats> {
  const storeFilter = storeIds === null ? {} : { storeId: { in: storeIds } };
  const listedVariantWhere: Prisma.ProductVariantWhereInput = {
    organizationId,
    ...storeFilter,
    ...LISTED_VARIANT_WHERE,
  };
  const missingVariantWhere: Prisma.ProductVariantWhereInput = {
    AND: [listedVariantWhere, MISSING_COST_VARIANT_WHERE],
  };
  const missingProductWhere: Prisma.ProductWhereInput = {
    organizationId,
    ...storeFilter,
    variants: { some: { AND: [LISTED_VARIANT_WHERE, MISSING_COST_VARIANT_WHERE] } },
  };

  const [listedRows, missingRows, missingProductRows] = await Promise.all([
    prisma.productVariant.groupBy({
      by: ['storeId'],
      where: listedVariantWhere,
      _count: true,
      orderBy: { storeId: 'asc' },
    }),
    prisma.productVariant.groupBy({
      by: ['storeId'],
      where: missingVariantWhere,
      _count: true,
    }),
    prisma.product.groupBy({
      by: ['storeId'],
      where: missingProductWhere,
      _count: true,
    }),
  ]);

  const missingByStore = new Map(missingRows.map((row) => [row.storeId, row._count]));
  const missingProductsByStore = new Map(
    missingProductRows.map((row) => [row.storeId, row._count]),
  );

  // byStore lists every store with at least one in-scope variant (stores with
  // nothing missing included) and carries the store's own counts, so a
  // store-scoped consumer can render "N products / M variants missing" for the
  // active store without mixing in other stores.
  let count = 0;
  let missingProductCount = 0;
  let totalVariants = 0;
  const byStore: MissingCostStats['byStore'] = [];
  for (const row of listedRows) {
    const storeMissing = missingByStore.get(row.storeId) ?? 0;
    const storeMissingProducts = missingProductsByStore.get(row.storeId) ?? 0;
    count += storeMissing;
    missingProductCount += storeMissingProducts;
    totalVariants += row._count;
    byStore.push({
      storeId: row.storeId,
      missingCount: storeMissing,
      missingProductCount: storeMissingProducts,
      totalVariants: row._count,
    });
  }

  return { count, missingProductCount, totalVariants, byStore };
}

// ─── Facets ────────────────────────────────────────────────────────────

export async function facets(opts: {
  organizationId: string;
  storeId: string;
}): Promise<FacetsResponse> {
  const { organizationId, storeId } = opts;

  // Every facet counts over the default listing scope: a product counts when
  // at least one of its variants is in scope. So `total` equals the unfiltered
  // list's pagination.total, `missingCost` and `missingDesi` equal the
  // overrideMissing=cost and overrideMissing=desi lists' totals, and the
  // brand/category options never offer a value whose products are all archived
  // or delisted.
  const listedProductWhere: Prisma.ProductWhereInput = {
    organizationId,
    storeId,
    variants: { some: LISTED_VARIANT_WHERE },
  };

  const [brandRows, categoryRows, missingCost, missingDesi, total] = await Promise.all([
    prisma.product.groupBy({
      by: ['brandId', 'brandName'],
      where: { ...listedProductWhere, brandId: { not: null }, brandName: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { brandId: 'desc' } },
    }),
    prisma.product.groupBy({
      by: ['categoryId', 'categoryName'],
      where: { ...listedProductWhere, categoryId: { not: null }, categoryName: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { categoryId: 'desc' } },
    }),
    prisma.product.count({
      where: {
        organizationId,
        storeId,
        variants: { some: { AND: [LISTED_VARIANT_WHERE, MISSING_COST_VARIANT_WHERE] } },
      },
    }),
    prisma.product.count({
      where: {
        organizationId,
        storeId,
        variants: { some: { AND: [LISTED_VARIANT_WHERE, MISSING_DESI_VARIANT_WHERE] } },
      },
    }),
    prisma.product.count({ where: listedProductWhere }),
  ]);

  return {
    brands: brandRows
      .filter(
        (r): r is typeof r & { brandId: bigint; brandName: string } =>
          r.brandId !== null && r.brandName !== null,
      )
      .map((r) => ({
        id: r.brandId.toString(),
        name: r.brandName,
        count: r._count._all,
      })),
    categories: categoryRows
      .filter(
        (r): r is typeof r & { categoryId: bigint; categoryName: string } =>
          r.categoryId !== null && r.categoryName !== null,
      )
      .map((r) => ({
        id: r.categoryId.toString(),
        name: r.categoryName,
        count: r._count._all,
      })),
    overrideCounts: { missingCost, missingDesi, total },
  };
}
