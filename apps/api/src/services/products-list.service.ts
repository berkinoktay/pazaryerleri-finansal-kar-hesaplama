// Read-side counterpart to ProductSyncService. Pure DB reads scoped to
// (orgId, storeId), with the four filters (q / status / brandId /
// categoryId) and 1-indexed offset pagination. Status filtering happens
// at the variant level so the parent's `variants[]` array is filtered
// to matching variants — but the parent itself is included whenever
// ≥1 of its variants matches.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Prisma } from '@pazarsync/db';

import { enumInWhere, rangeWhere } from '../lib/where-builders';
import { SHIPPING_ESTIMATE_CTE_SQL, type ShippingEstimateRow } from './shipping-estimator.sql';
import type {
  CostStatus,
  ListProductsQuery,
  ProductListSort,
  ProductOverrideMissing,
  ProductVariantStatus,
  VariantCostAggregate,
  VariantShippingEstimate,
} from '../validators/product.validator';
import {
  toProductWithVariantsResponse,
  type ListProductsResponseSchema,
  type ProductFacetsResponseSchema,
} from '../validators/product.validator';
import type { z } from '@hono/zod-openapi';

type ListResponse = z.infer<typeof ListProductsResponseSchema>;
type FacetsResponse = z.infer<typeof ProductFacetsResponseSchema>;

// ─── Where-clause builders ─────────────────────────────────────────────

function variantStatusWhere(status: ProductVariantStatus): Prisma.ProductVariantWhereInput {
  switch (status) {
    case 'onSale':
      return { onSale: true, archived: false, blacklisted: false, locked: false };
    case 'archived':
      return { archived: true };
    case 'locked':
      return { locked: true };
    case 'blacklisted':
      return { blacklisted: true };
  }
}

function variantOverrideMissingWhere(
  missing: ProductOverrideMissing,
): Prisma.ProductVariantWhereInput {
  switch (missing) {
    case 'cost':
      return { costPrice: null };
    case 'vat':
      return { vatRate: null };
  }
}

function buildSearchWhere(q: string): Prisma.ProductWhereInput {
  return {
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { productMainId: { contains: q, mode: 'insensitive' } },
      { variants: { some: { barcode: { contains: q, mode: 'insensitive' } } } },
      { variants: { some: { stockCode: { contains: q, mode: 'insensitive' } } } },
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
      // the extreme the seller means. Both columns are denormalized
      // transactionally in the sync worker (mirrors totalStock) — see
      // apps/sync-worker/src/handlers/products.ts.
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

  // Variant-level filters compose with AND. Today: status (onSale/archived/…)
  // and overrideMissing (cost/vat). The parent is included if ≥1 variant
  // matches; the response variants[] is filtered to matching variants.
  const variantConditions: Prisma.ProductVariantWhereInput[] = [];
  if (filters.status !== undefined) {
    variantConditions.push(variantStatusWhere(filters.status));
  }
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
  const variantWhere: Prisma.ProductVariantWhereInput | undefined =
    variantConditions.length === 0
      ? undefined
      : variantConditions.length === 1
        ? variantConditions[0]
        : { AND: variantConditions };

  const productWhere: Prisma.ProductWhereInput = {
    organizationId,
    storeId,
    ...(filters.productId !== undefined ? { id: filters.productId } : {}),
    ...(variantWhere !== undefined ? { variants: { some: variantWhere } } : {}),
    ...(filters.q !== undefined ? buildSearchWhere(filters.q) : {}),
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
        // Filter the variants[] in the response when status is set —
        // matches the contract documented on ListProductsQuerySchema.
        // No `_count` — variantCount is now derived from variants.length
        // inside the mapper, so the count chip / Beden chips / expanded
        // sub-rows on the UI can never disagree.
        variants: variantWhere !== undefined ? { where: variantWhere } : true,
        images: true,
      },
      orderBy: buildOrderBy(filters.sort),
      take: filters.perPage,
      skip,
    }),
    prisma.product.count({ where: productWhere }),
  ]);

  // Collect all variant IDs from this page and run the cost aggregate
  // in a single raw-SQL query (per spec §5.5). The LATERAL join resolves
  // the most recent FX rate per AUTO-mode non-TRY profile. Results are
  // keyed by variant id for O(1) lookup in the mapper.
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
  const rows = await prisma.$queryRawUnsafe<ShippingEstimateRow[]>(
    SHIPPING_ESTIMATE_CTE_SQL,
    organizationId,
    storeId,
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
// Raw SQL per spec §5.5. The LATERAL subquery finds the most-recent FX
// rate for AUTO non-TRY profiles. The result is a flat list keyed by
// variant_id; the caller builds a Map<id, VariantCostAggregate> for
// O(1) lookup in the mapper.
//
// FX staleness threshold: rates older than 2 days are flagged FX_STALE
// (per spec §5.8 "Variant with profiles, FX rate stale (>2 days)").

const FX_STALE_DAYS = 2;

interface CostAggregateRow {
  variant_id: string;
  current_cost_try: unknown; // Decimal from PG — coerce below
  profile_count: bigint; // Prisma $queryRaw returns bigint for COUNT
  has_auto_non_try: boolean;
  fx_rate_date: Date | null;
}

function deriveCostStatus(
  profileCount: number,
  hasAutoNonTry: boolean,
  fxRateDate: Date | null,
): CostStatus {
  if (profileCount === 0) return 'NO_PROFILES';
  if (!hasAutoNonTry) return 'OK';
  if (fxRateDate === null) return 'FX_MISSING';
  const ageDays = (Date.now() - fxRateDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > FX_STALE_DAYS) return 'FX_STALE';
  return 'OK';
}

async function fetchCostAggregates(
  organizationId: string,
  variantIds: string[],
): Promise<Map<string, VariantCostAggregate>> {
  if (variantIds.length === 0) return new Map();

  // Cast to uuid[] so Postgres can match against the typed column.
  const rows = await prisma.$queryRaw<CostAggregateRow[]>`
    SELECT
      pv.id                                             AS variant_id,
      COALESCE(SUM(
        CASE
          WHEN cp.currency = 'TRY'                           THEN cp.amount
          WHEN cp.fx_rate_mode = 'MANUAL'                    THEN cp.amount * cp.manual_fx_rate
          WHEN cp.fx_rate_mode = 'AUTO' AND fx.rate_to_try IS NOT NULL
                                                             THEN cp.amount * fx.rate_to_try
          ELSE NULL
        END
      ), 0)::DECIMAL(12,2)                              AS current_cost_try,
      COUNT(cp.id)                                      AS profile_count,
      BOOL_OR(
        cp.currency != 'TRY' AND cp.fx_rate_mode = 'AUTO'
      )                                                 AS has_auto_non_try,
      MAX(fx.rate_date)                                 AS fx_rate_date
    FROM product_variants pv
    LEFT JOIN product_variant_cost_profiles pvcp
      ON pvcp.product_variant_id = pv.id
    LEFT JOIN cost_profiles cp
      ON cp.id = pvcp.profile_id AND cp.archived_at IS NULL
    LEFT JOIN LATERAL (
      SELECT rate_to_try, rate_date
      FROM fx_rates
      WHERE currency = cp.currency
      ORDER BY rate_date DESC
      LIMIT 1
    ) fx ON cp.currency != 'TRY' AND cp.fx_rate_mode = 'AUTO'
    WHERE pv.id = ANY(${variantIds}::uuid[])
      AND pv.organization_id = ${organizationId}::uuid
    GROUP BY pv.id
  `;

  const result = new Map<string, VariantCostAggregate>();
  for (const row of rows) {
    const profileCount = Number(row.profile_count);
    const hasAutoNonTry = row.has_auto_non_try ?? false;
    const costStatus = deriveCostStatus(profileCount, hasAutoNonTry, row.fx_rate_date);
    // FX_MISSING means the AUTO currency profile has no rate — the SQL SUM
    // evaluates to 0 (via COALESCE) but the semantic value is "unknown".
    // Surface null instead of a misleading 0.00.
    const showCost = profileCount > 0 && costStatus !== 'FX_MISSING';
    const rawCost = row.current_cost_try;
    const costDecimal =
      rawCost !== null && rawCost !== undefined ? new Decimal(String(rawCost)) : new Decimal(0);
    result.set(row.variant_id, {
      currentCostTry: showCost ? costDecimal.toFixed(2) : null,
      profileCount,
      costStatus,
    });
  }
  return result;
}

// ─── Missing-cost stats ────────────────────────────────────────────────

export interface MissingCostStats {
  count: number;
  totalVariants: number;
  byStore: { storeId: string; missingCount: number }[];
}

export async function missingCostStats(organizationId: string): Promise<MissingCostStats> {
  // Reuse the same logic as fetchCostAggregates but org-wide:
  // find variants with profileCount = 0.
  const rows = await prisma.$queryRaw<
    { store_id: string; missing_count: bigint; total_variants: bigint }[]
  >`
    SELECT
      pv.store_id                             AS store_id,
      COUNT(*) FILTER (
        WHERE (
          SELECT COUNT(pvcp.id)
          FROM product_variant_cost_profiles pvcp
          INNER JOIN cost_profiles cp
            ON cp.id = pvcp.profile_id AND cp.archived_at IS NULL
          WHERE pvcp.product_variant_id = pv.id
        ) = 0
      )                                       AS missing_count,
      COUNT(*)                                AS total_variants
    FROM product_variants pv
    WHERE pv.organization_id = ${organizationId}::uuid
    GROUP BY pv.store_id
  `;

  let totalMissing = 0;
  let totalVariants = 0;
  const byStore: { storeId: string; missingCount: number }[] = [];

  for (const row of rows) {
    const missingCount = Number(row.missing_count);
    const variantCount = Number(row.total_variants);
    totalMissing += missingCount;
    totalVariants += variantCount;
    byStore.push({ storeId: row.store_id, missingCount });
  }

  return { count: totalMissing, totalVariants, byStore };
}

// ─── Facets ────────────────────────────────────────────────────────────

export async function facets(opts: {
  organizationId: string;
  storeId: string;
}): Promise<FacetsResponse> {
  const { organizationId, storeId } = opts;

  const [brandRows, categoryRows, missingCost, missingVat, total] = await Promise.all([
    prisma.product.groupBy({
      by: ['brandId', 'brandName'],
      where: { organizationId, storeId, brandId: { not: null }, brandName: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { brandId: 'desc' } },
    }),
    prisma.product.groupBy({
      by: ['categoryId', 'categoryName'],
      where: {
        organizationId,
        storeId,
        categoryId: { not: null },
        categoryName: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { categoryId: 'desc' } },
    }),
    prisma.product.count({
      where: { organizationId, storeId, variants: { some: { costPrice: null } } },
    }),
    prisma.product.count({
      where: { organizationId, storeId, variants: { some: { vatRate: null } } },
    }),
    prisma.product.count({ where: { organizationId, storeId } }),
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
    overrideCounts: { missingCost, missingVat, total },
  };
}
