// Read-side counterpart to ProductSyncService. Pure DB reads scoped to
// (orgId, storeId), with the four filters (q / status / brandId /
// categoryId) and 1-indexed offset pagination. Status filtering happens
// at the variant level so the parent's `variants[]` array is filtered
// to matching variants — but the parent itself is included whenever
// ≥1 of its variants matches.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Prisma } from '@pazarsync/db';

import type {
  CostStatus,
  ListProductsQuery,
  ProductListSort,
  ProductOverrideMissing,
  ProductVariantStatus,
  VariantCostAggregate,
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
    case '-salePrice':
      // Prisma can't natively MAX over a decimal child relation without
      // raw SQL or a denormalized column. Until we ship Product.minSalePrice
      // (follow-up), sort by platformCreatedAt as a deterministic fallback
      // when the user picks salePrice. Surfaced as a known limitation in
      // the validator's openapi description.
      return { platformCreatedAt: { sort: sort.startsWith('-') ? 'desc' : 'asc', nulls: 'last' } };
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
  const variantWhere: Prisma.ProductVariantWhereInput | undefined =
    variantConditions.length === 0
      ? undefined
      : variantConditions.length === 1
        ? variantConditions[0]
        : { AND: variantConditions };

  const productWhere: Prisma.ProductWhereInput = {
    organizationId,
    storeId,
    ...(filters.brandId !== undefined ? { brandId: filters.brandId } : {}),
    ...(filters.categoryId !== undefined ? { categoryId: filters.categoryId } : {}),
    ...(variantWhere !== undefined ? { variants: { some: variantWhere } } : {}),
    ...(filters.q !== undefined ? buildSearchWhere(filters.q) : {}),
  };

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
  const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const costByVariantId = await fetchCostAggregates(organizationId, variantIds);

  const totalPages = total === 0 ? 0 : Math.ceil(total / filters.perPage);

  return {
    data: products.map((product) => toProductWithVariantsResponse(product, costByVariantId)),
    pagination: {
      page: filters.page,
      perPage: filters.perPage,
      total,
      totalPages,
    },
  };
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
