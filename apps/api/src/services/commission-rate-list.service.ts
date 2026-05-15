import { prisma } from '@pazarsync/db';
import type { Platform, Prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { NotFoundError, ValidationError } from '../lib/errors';
import type {
  CommissionRateListItem,
  ListCommissionRatesQuery,
  ListCommissionRatesResponse,
} from '../validators/commission-rate.validator';

// Public input/output ─────────────────────────────────────────────────────────

export type ListCommissionRatesFilters = ListCommissionRatesQuery;

export type ListCommissionRatesResult = ListCommissionRatesResponse;

// Internal helpers ────────────────────────────────────────────────────────────

interface ProductCounts {
  // CATEGORY rule scope: total approved+unarchived products in the category
  // across all brands. Key = categoryId.
  categoryCount: Map<string, number>;
  // CATEGORY_BRAND rule scope: count for the exact (categoryId, brandId) pair.
  // Key = `${categoryId}:${brandId}`.
  categoryBrandCount: Map<string, number>;
}

/**
 * Verifies the store belongs to the org and returns its platform. Throws
 * NotFoundError (not Forbidden) to avoid leaking the existence of stores
 * in other orgs — per SECURITY.md §3 the same response shape for
 * "doesn't exist" and "not yours".
 *
 * The platform is needed because commission rates are platform-scoped
 * reference data (NOT per-store): a Trendyol store reads the global
 * TRENDYOL tariff. Looking it up here keeps the URL store-scoped (so the
 * productScope=active filter and productCount metric stay coherent with
 * the seller's view) while the rate query itself filters by platform.
 */
async function resolveStorePlatform(organizationId: string, storeId: string): Promise<Platform> {
  const row = await prisma.store.findFirst({
    where: { id: storeId, organizationId },
    select: { platform: true },
  });
  if (row === null) {
    throw new NotFoundError('Store', storeId);
  }
  return row.platform;
}

/**
 * Single pass over Product rows to build two count maps used by both the
 * productCount column (always) and the productScope=active WHERE clause.
 * "Active" = Product.approved AND has ≥1 variant where archived=false.
 *
 * Returns counts of distinct *products* per scope (not variants) — that
 * matches the panel UX "kategoride X ürün var" rather than "X SKU var".
 */
async function fetchProductCounts(organizationId: string, storeId: string): Promise<ProductCounts> {
  const rows = await prisma.product.findMany({
    where: {
      organizationId,
      storeId,
      approved: true,
      categoryId: { not: null },
      variants: { some: { archived: false } },
    },
    select: { categoryId: true, brandId: true },
  });

  const categoryCount = new Map<string, number>();
  const categoryBrandCount = new Map<string, number>();

  for (const row of rows) {
    if (row.categoryId === null) continue;
    const catKey = row.categoryId.toString();
    categoryCount.set(catKey, (categoryCount.get(catKey) ?? 0) + 1);
    if (row.brandId !== null) {
      const pairKey = `${catKey}:${row.brandId.toString()}`;
      categoryBrandCount.set(pairKey, (categoryBrandCount.get(pairKey) ?? 0) + 1);
    }
  }

  return { categoryCount, categoryBrandCount };
}

function buildSearchClause(q: string): Prisma.MarketplaceCommissionRateWhereInput {
  return {
    OR: [
      { categoryName: { contains: q, mode: 'insensitive' } },
      { parentCategoryName: { contains: q, mode: 'insensitive' } },
      { brandName: { contains: q, mode: 'insensitive' } },
    ],
  };
}

/**
 * Restricts the result set to rows whose (categoryId[, brandId]) match a
 * product the store actually sells. Reuses the maps computed by
 * `fetchProductCounts` so we don't hit Product twice.
 *
 * When the store has no active products in the relevant scope, returns a
 * clause that forces an empty result (`id: { in: [] }`) — cleaner than
 * branching on "skip the query entirely" and lets the offset query return
 * zero rows with `pagination.total = 0` naturally.
 */
function buildActiveScopeClause(
  ruleKind: ListCommissionRatesFilters['ruleKind'],
  counts: ProductCounts,
): Prisma.MarketplaceCommissionRateWhereInput {
  if (ruleKind === 'CATEGORY') {
    const ids = [...counts.categoryCount.keys()].map((k) => BigInt(k));
    if (ids.length === 0) return { id: { in: [] } };
    return { categoryId: { in: ids } };
  }
  // CATEGORY_BRAND — Prisma has no tuple-IN, expand to OR of (cat AND brand).
  const pairs = [...counts.categoryBrandCount.keys()].map((key) => {
    const [c, b] = key.split(':');
    // c and b are non-empty by construction in fetchProductCounts.
    return { categoryId: BigInt(c as string), brandId: BigInt(b as string) };
  });
  if (pairs.length === 0) return { id: { in: [] } };
  return { OR: pairs };
}

type SortKey = ListCommissionRatesFilters['sort'];

function buildOrderBy(sort: SortKey): Prisma.MarketplaceCommissionRateOrderByWithRelationInput[] {
  switch (sort) {
    case 'category_name:asc':
      return [{ categoryName: 'asc' }, { brandName: 'asc' }, { id: 'asc' }];
    case 'base_rate:asc':
      return [{ baseRate: 'asc' }, { id: 'asc' }];
    case 'base_rate:desc':
      return [{ baseRate: 'desc' }, { id: 'asc' }];
    case 'product_count:desc':
      // No DB-side equivalent — the product_count:desc branch sorts in
      // memory inside listSortedByProductCount. Reached only when the
      // caller routes through the DB-side branch by mistake; deterministic
      // fallback keeps the response stable instead of erroring at the DB.
      return [{ id: 'asc' }];
  }
}

type CommissionRateRow = Prisma.MarketplaceCommissionRateGetPayload<Record<string, never>>;

function lookupProductCount(row: CommissionRateRow, counts: ProductCounts): number {
  const catKey = row.categoryId.toString();
  if (row.ruleKind === 'CATEGORY') {
    return counts.categoryCount.get(catKey) ?? 0;
  }
  if (row.brandId === null) return 0;
  return counts.categoryBrandCount.get(`${catKey}:${row.brandId.toString()}`) ?? 0;
}

function toWireItem(row: CommissionRateRow, productCount: number): CommissionRateListItem {
  // `segmentOverrides` is JSONB → arrives typed as `Prisma.JsonValue`. The
  // import contract writes only string-to-string maps (decimal strings), so
  // the cast is safe; defensive normalization filters out anything else.
  const rawOverrides = row.segmentOverrides as unknown;
  const overrides: Record<string, string> = {};
  if (typeof rawOverrides === 'object' && rawOverrides !== null && !Array.isArray(rawOverrides)) {
    for (const [k, v] of Object.entries(rawOverrides as Record<string, unknown>)) {
      if (typeof v === 'string') overrides[k] = v;
    }
  }

  return {
    id: row.id,
    ruleKind: row.ruleKind,
    platform: row.platform,
    categoryId: row.categoryId.toString(),
    brandId: row.brandId !== null ? row.brandId.toString() : null,
    categoryName: row.categoryName,
    parentCategoryName: row.parentCategoryName,
    brandName: row.brandName,
    baseRate: row.baseRate.toString(),
    paymentTermDays: row.paymentTermDays,
    segmentOverrides: overrides,
    productCount,
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

interface BuildPageArgs {
  rows: CommissionRateRow[];
  counts: ProductCounts;
  page: number;
  perPage: number;
  total: number;
}

function buildPage({
  rows,
  counts,
  page,
  perPage,
  total,
}: BuildPageArgs): ListCommissionRatesResult {
  const data = rows.map((row) => toWireItem(row, lookupProductCount(row, counts)));
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);
  return {
    data,
    pagination: { page, perPage, total, totalPages },
  };
}

/**
 * In-memory sort path for `sort=product_count:desc`. The DB has no
 * product_count column, so we materialize all rows matching the WHERE,
 * annotate each with its productCount, sort by (count desc, id asc),
 * then offset-slice the result by `(page-1) * perPage`. Bounded by the
 * `productScope=active` invariant the public entry point enforces — that
 * gate prevents this path from loading the full 135K-row tariff into
 * memory.
 */
async function listSortedByProductCount(
  where: Prisma.MarketplaceCommissionRateWhereInput,
  counts: ProductCounts,
  filters: ListCommissionRatesFilters,
): Promise<ListCommissionRatesResult> {
  const allRows = await prisma.marketplaceCommissionRate.findMany({ where });

  const annotated = allRows
    .map((row) => ({ row, count: lookupProductCount(row, counts) }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
    });

  const total = annotated.length;
  const skip = (filters.page - 1) * filters.perPage;
  const window = annotated.slice(skip, skip + filters.perPage);

  const data = window.map((entry) => toWireItem(entry.row, entry.count));
  const totalPages = total === 0 ? 0 : Math.ceil(total / filters.perPage);

  return {
    data,
    pagination: { page: filters.page, perPage: filters.perPage, total, totalPages },
  };
}

// Public entry point ──────────────────────────────────────────────────────────

export async function listCommissionRates(
  organizationId: string,
  storeId: string,
  filters: ListCommissionRatesFilters,
): Promise<ListCommissionRatesResult> {
  const platform = await resolveStorePlatform(organizationId, storeId);

  if (filters.sort === 'product_count:desc' && filters.productScope !== 'active') {
    throw new ValidationError([
      {
        field: 'sort',
        code: 'INVALID_SORT_FOR_SCOPE',
        meta: { requiredProductScope: 'active' },
      },
    ]);
  }

  const counts = await fetchProductCounts(organizationId, storeId);

  const where: Prisma.MarketplaceCommissionRateWhereInput = {
    platform,
    ruleKind: filters.ruleKind,
    ...(filters.q !== undefined ? buildSearchClause(filters.q) : {}),
    ...(filters.productScope === 'active' ? buildActiveScopeClause(filters.ruleKind, counts) : {}),
  };

  if (filters.sort === 'product_count:desc') {
    return listSortedByProductCount(where, counts, filters);
  }

  const skip = (filters.page - 1) * filters.perPage;
  let rows: CommissionRateRow[];
  let total: number;
  try {
    [rows, total] = await prisma.$transaction([
      prisma.marketplaceCommissionRate.findMany({
        where,
        orderBy: buildOrderBy(filters.sort),
        skip,
        take: filters.perPage,
      }),
      prisma.marketplaceCommissionRate.count({ where }),
    ]);
  } catch (err) {
    mapPrismaError(err);
  }

  return buildPage({ rows, counts, page: filters.page, perPage: filters.perPage, total });
}
