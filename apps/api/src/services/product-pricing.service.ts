// Service for the product pricing backend.
//
// The list and the quote price every variant with the shared scenario engine
// (`@pazarsync/profit`): `loadTrendyolScenarioBases` reads cost, commission, fee and
// shipping inputs for the whole page in a constant number of queries, then
// `evaluateTrendyolScenario` scores each variant at its sale price and
// `solveTrendyolScenarioPrice` finds the price for a quote target. All financial math
// lives in the engine (feedback_no_frontend_financial_calculation); this service only
// maps the engine's statement onto the wire and never re-implements a formula.
//
// Rows are ALWAYS returned, calculable or not, so the user sees which input is
// missing. The three independent statuses are read from the statement's issues
// (MISSING_COST -> NO_PROFILES, SHIPPING_ESTIMATE_UNAVAILABLE -> the shipping status,
// MISSING_COMMISSION_RATE -> NO_RULE); a variant is calculable only when all three are
// OK (deriveCalculable). When not calculable, profit/margin fields are null. A variant
// whose sale price is 0 is not scored at all (noPriceRow): not calculable, empty profit.

import { Decimal } from 'decimal.js';

import { LISTED_VARIANT_WHERE } from '@pazarsync/catalog-sync';
import type { Prisma } from '@pazarsync/db';
import { ProfitIssueCode } from '@pazarsync/db/enums';
import {
  buildStatementBreakdown,
  evaluateTrendyolScenario,
  loadTrendyolScenarioBases,
  solveTrendyolScenarioPrice,
  statementTotalsFromStatement,
  UnsupportedPlatformError,
  type ProfitIssue,
  type ProfitStatement,
  type ScenarioLoadResult,
  type ScenarioPriceTarget,
  type ScenarioSolveFailure,
  type ShippingUnavailableReason,
} from '@pazarsync/profit';

// Quote-level failure reason, mirrored by QuoteReasonSchema in product-pricing.validator.
// NOT_CALCULABLE: no price produced a computable statement (shipping or commission
// missing), so the solver found no priceable point.
export type QuoteReason =
  | 'NOT_PRICE_SENSITIVE'
  | 'UNREACHABLE_TARGET'
  | 'NO_COST'
  | 'NOT_CALCULABLE';
import { InvalidReferenceError, mapPrismaError } from '@pazarsync/sync-core';

import { deriveCalculable } from './product-pricing-assembly';
import { logProfitReadFailure } from './profit-compute-fallback.service';
import { createRequestFailureLog, formatMarginPct2, formatMoney2 } from './scenario-screen-commons';
import type {
  CommissionStatus,
  CostStatus,
  ProductPricingRow,
  ShippingEstimateStatus,
} from './product-pricing.types';

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * The unit price the quote probes the loaded base at to read whether the cost resolved.
 * Zero is a valid scenario (Faz 4B Task 1: a free item still deducts its cost and fees),
 * and the seller cost lines do not depend on the price, so a MISSING_COST at zero is
 * exactly the one the list raises -- the probe lets list and quote agree. That agreement
 * holds for priced variants only: the list does not check a zero-priced variant's inputs
 * (see `noPriceRow`), while the quote still evaluates it.
 */
const COST_PROBE_UNIT_PRICE = new Decimal(0);

// ─── Filters ─────────────────────────────────────────────────────────────────

export type ProfitStatusFilter = 'profitable' | 'breakeven' | 'loss' | 'all';

export interface ListProductPricingFilters {
  page: number;
  perPage: number;
  q?: string;
  sortBy?: ProductPricingSort;
  calculableOnly?: boolean;
  profitStatus?: ProfitStatusFilter;
  marginMin?: string;
  marginMax?: string;
  categoryId?: string;
  brandId?: string;
}

export type ProductPricingSort =
  | 'salePrice:asc'
  | 'salePrice:desc'
  | 'title:asc'
  | 'title:desc'
  | 'netProfit:asc'
  | 'netProfit:desc'
  | 'saleMarginPct:asc'
  | 'saleMarginPct:desc'
  | 'costMarkupPct:asc'
  | 'costMarkupPct:desc';

// --- Variant shape for the list pipeline ---

/**
 * The variant columns the LIST pipeline reads: the identity + sale/VAT/digital fields the
 * scenario evaluation needs, plus the category/brand names and the primary image the list
 * rows surface.
 */
interface VariantForListRow {
  id: string;
  stockCode: string;
  barcode: string;
  salePrice: Prisma.Decimal;
  vatRate: number | null;
  isDigital: boolean;
  product: {
    title: string;
    categoryId: bigint | null;
    categoryName: string | null;
    brandId: bigint | null;
    brandName: string | null;
    imageUrls: string[];
  };
}

// ─── Query builders ───────────────────────────────────────────────────────────

function buildSearchWhere(q: string): Prisma.ProductVariantWhereInput {
  return {
    OR: [
      { barcode: { contains: q, mode: 'insensitive' } },
      { stockCode: { contains: q, mode: 'insensitive' } },
      { product: { title: { contains: q, mode: 'insensitive' } } },
    ],
  };
}

/**
 * SQL ordering for the candidate set. Only the two TRUE-column sorts
 * (salePrice/title) are expressible in Prisma `orderBy`; the profit / margin /
 * markup sorts operate on COMPUTED in-memory values, so for those the SQL order
 * is a stable placeholder (salePrice:asc + id) and the real ordering is applied
 * by `compareRows` after the in-memory profit math. This replaces the previous
 * salePrice PROXY (which wrongly let Prisma "sort by profit" via salePrice).
 */
function buildCandidateOrderBy(
  sort: ProductPricingSort | undefined,
): Prisma.ProductVariantOrderByWithRelationInput {
  switch (sort) {
    case 'salePrice:asc':
      return { salePrice: 'asc' };
    case 'salePrice:desc':
      return { salePrice: 'desc' };
    case 'title:asc':
      return { product: { title: 'asc' } };
    case 'title:desc':
      return { product: { title: 'desc' } };
    // Computed-value sorts: ordering is decided in memory by compareRows. Use a
    // stable, deterministic candidate order so the in-memory sort's tie-breaks
    // (and the no-op path when every value is null) are reproducible.
    case 'netProfit:asc':
    case 'netProfit:desc':
    case 'saleMarginPct:asc':
    case 'saleMarginPct:desc':
    case 'costMarkupPct:asc':
    case 'costMarkupPct:desc':
    case undefined:
      return { salePrice: 'asc' };
    default: {
      const _exhaustive: never = sort;
      throw new Error(`Unhandled product pricing sort: ${_exhaustive}`);
    }
  }
}

// ─── In-memory computed row (filter + sort working copy) ──────────────────────

/**
 * The product-pricing row PLUS the un-serialized profit metrics kept as
 * `Decimal | null`. The list pipeline computes EVERY listed variant in memory,
 * then filters / sorts by these numeric copies (decimal.js compares, never
 * float), and finally serializes the surviving page to `ProductPricingRow`. The
 * numeric copies never leave the service.
 */
interface ComputedPricingRow {
  row: ProductPricingRow;
  netProfit: Decimal | null;
  saleMarginPct: Decimal | null;
  costMarkupPct: Decimal | null;
}

/**
 * Builds the SQL `where` for the candidate set: org + store + the shared products-page
 * listing scope + cheap filters. `LISTED_VARIANT_WHERE` (delistedAt null, status not
 * ARCHIVED) is ANDed in so this list shows exactly the variants the products page shows
 * by default -- a delisted or archived variant never appears here.
 */
function buildListWhere(
  orgId: string,
  storeId: string,
  filters: ListProductPricingFilters,
): Prisma.ProductVariantWhereInput {
  const productWhere: Prisma.ProductWhereInput = {};
  if (filters.categoryId !== undefined) {
    productWhere.categoryId = BigInt(filters.categoryId);
  }
  if (filters.brandId !== undefined) {
    productWhere.brandId = BigInt(filters.brandId);
  }
  return {
    ...LISTED_VARIANT_WHERE,
    organizationId: orgId,
    storeId,
    product: productWhere,
    ...(filters.q !== undefined ? buildSearchWhere(filters.q) : {}),
  };
}

/** Maps a `profitStatus` filter value to a netProfit predicate. `null` rows never match a direction. */
function matchesProfitStatus(status: ProfitStatusFilter, netProfit: Decimal | null): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'profitable':
      return netProfit !== null && netProfit.gt(0);
    case 'breakeven':
      return netProfit !== null && netProfit.isZero();
    case 'loss':
      return netProfit !== null && netProfit.lt(0);
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled profit status filter: ${_exhaustive}`);
    }
  }
}

/** Applies the in-memory filters (calculableOnly, profitStatus, margin range) to the computed rows. */
function applyInMemoryFilters(
  rows: ComputedPricingRow[],
  filters: ListProductPricingFilters,
): ComputedPricingRow[] {
  const profitStatus = filters.profitStatus ?? 'all';
  const marginMin = filters.marginMin !== undefined ? new Decimal(filters.marginMin) : null;
  const marginMax = filters.marginMax !== undefined ? new Decimal(filters.marginMax) : null;

  return rows.filter((computed) => {
    if (filters.calculableOnly === true && !computed.row.calculable) return false;
    if (!matchesProfitStatus(profitStatus, computed.netProfit)) return false;
    // Margin range: a null margin is excluded whenever either bound is set.
    if (marginMin !== null || marginMax !== null) {
      if (computed.saleMarginPct === null) return false;
      if (marginMin !== null && computed.saleMarginPct.lt(marginMin)) return false;
      if (marginMax !== null && computed.saleMarginPct.gt(marginMax)) return false;
    }
    return true;
  });
}

/** Reads the sortable numeric field for a computed-value sort. */
function computedSortValue(computed: ComputedPricingRow, sort: ProductPricingSort): Decimal | null {
  switch (sort) {
    case 'netProfit:asc':
    case 'netProfit:desc':
      return computed.netProfit;
    case 'saleMarginPct:asc':
    case 'saleMarginPct:desc':
      return computed.saleMarginPct;
    case 'costMarkupPct:asc':
    case 'costMarkupPct:desc':
      return computed.costMarkupPct;
    case 'salePrice:asc':
    case 'salePrice:desc':
    case 'title:asc':
    case 'title:desc':
    case undefined:
      return null;
    default: {
      const _exhaustive: never = sort;
      throw new Error(`Unhandled product pricing sort: ${_exhaustive}`);
    }
  }
}

/**
 * Sorts the computed rows. salePrice/title (and the undefined default) keep the
 * SQL order untouched — the candidate query already ordered by salePrice:asc/id
 * or title. The profit/margin/markup sorts compare the COMPUTED Decimal values;
 * null values always sort LAST regardless of asc/desc (decimal.js comparison —
 * never float). Stable: equal keys preserve the SQL candidate order.
 */
function sortComputedRows(
  rows: ComputedPricingRow[],
  sort: ProductPricingSort | undefined,
): ComputedPricingRow[] {
  // salePrice/title and the default already arrive in the right SQL order.
  if (
    sort === undefined ||
    sort === 'salePrice:asc' ||
    sort === 'salePrice:desc' ||
    sort === 'title:asc' ||
    sort === 'title:desc'
  ) {
    return rows;
  }

  const desc = sort.endsWith(':desc');
  // Array.prototype.sort is stable in Node ≥ 12, so equal keys keep SQL order.
  return [...rows].sort((a, b) => {
    const av = computedSortValue(a, sort);
    const bv = computedSortValue(b, sort);
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // nulls last
    if (bv === null) return -1; // nulls last
    const cmp = av.comparedTo(bv);
    return desc ? -cmp : cmp;
  });
}

// ─── List entry point ─────────────────────────────────────────────────────────

/**
 * Loads the scenario base of every candidate variant in one pass and evaluates each at
 * its own `salePrice`, turning the engine's statement into a computed row. The scenario
 * date is `now` (this screen prices at the current instant). The query count is
 * constant: `loadTrendyolScenarioBases` reads the store, the variants and all reference
 * data once, regardless of how many variants are passed.
 *
 * Degradation (decision 9, owner rule -- the list always returns 200): a store-wide
 * loader failure (missing fee definitions, a non-Trendyol store, ...) empties every
 * row's profit and is logged once; a variant whose own evaluation throws empties only
 * its own profit. The per-variant failures are logged ONCE per request (the first error
 * with the failed count), so a systemic failure on a large catalog writes one line, not
 * one per row. An `UnsupportedPlatformError` degrades without an error log, exactly as
 * the order read path treats it.
 */
async function computeScenarioRows(
  db: Prisma.TransactionClient,
  orgId: string,
  storeId: string,
  now: Date,
  variants: readonly VariantForListRow[],
): Promise<ComputedPricingRow[]> {
  let bases: ReadonlyMap<string, ScenarioLoadResult> | null;
  try {
    bases = await loadTrendyolScenarioBases(db, {
      organizationId: orgId,
      storeId,
      scenarioDate: now,
      variants: variants.map((variant) => ({ variantId: variant.id })),
    });
  } catch (err) {
    if (!(err instanceof UnsupportedPlatformError)) {
      logProfitReadFailure({
        surface: 'product-pricing',
        organizationId: orgId,
        orderId: null,
        err,
      });
    }
    bases = null;
  }

  // Collect per-variant evaluation failures and log them once after the pass, so a
  // systemic per-variant failure on a large list is one log line.
  const failureLog = createRequestFailureLog({ surface: 'product-pricing', organizationId: orgId });

  const rows = variants.map((variant): ComputedPricingRow => {
    // Owner decision 2026-11-10: a zero sale price is not a price (most locked or
    // blacklisted stage products carry 0), so the variant is not scored. Not a failure,
    // so nothing is logged.
    if (variant.salePrice.isZero()) {
      return noPriceRow(variant);
    }
    const loaded = bases === null ? undefined : bases.get(variant.id);
    if (loaded === undefined || loaded.kind !== 'ready') {
      return degradedRow(variant);
    }
    try {
      const { statement } = evaluateTrendyolScenario({
        ...loaded.base,
        unitPrice: new Decimal(variant.salePrice.toString()),
      });
      return computeRowFromStatement(variant, statement);
    } catch (err) {
      failureLog.record(err);
      return degradedRow(variant);
    }
  });

  failureLog.flush();

  return rows;
}

/**
 * Lists per-variant forward pricing for a store's LISTED products (the products-page
 * default scope: not delisted, not ARCHIVED). Computes
 * EVERY candidate variant's profit in memory with the scenario engine (one batch
 * load -- no N+1), then filters / sorts / paginates IN MEMORY so the profit/margin
 * sorts and filters operate on the live computed values and `total` is the exact
 * filtered count. Calculability is reported per row so the user can see and fix the
 * gaps. `imageUrl` / `cost` / category + brand names are included.
 *
 * `db` is injected (not the module client) so the query count is observable; the route
 * passes the shared client. No interactive transaction: the whole path is read-only, so
 * plain reads remove the 5 s transaction ceiling that a large catalog would hit.
 */
export async function listProductPricing(
  db: Prisma.TransactionClient,
  orgId: string,
  storeId: string,
  filters: ListProductPricingFilters,
): Promise<{ data: ProductPricingRow[]; total: number }> {
  const where = buildListWhere(orgId, storeId, filters);

  // 1. Candidate set -- ALL listed variants matching the cheap SQL filters.
  //    No skip/take here: the full set must be computed before in-memory
  //    filter/sort/paginate can produce a correct `total`.
  let variants: VariantForListRow[];
  try {
    variants = await db.productVariant.findMany({
      where,
      select: {
        id: true,
        stockCode: true,
        barcode: true,
        salePrice: true,
        vatRate: true,
        isDigital: true,
        product: {
          select: {
            title: true,
            categoryId: true,
            categoryName: true,
            brandId: true,
            brandName: true,
            imageUrls: true,
          },
        },
      },
      orderBy: [buildCandidateOrderBy(filters.sortBy), { id: 'asc' }],
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (variants.length === 0) {
    return { data: [], total: 0 };
  }

  // 2. Compute every variant with the scenario engine (constant query count).
  const computed = await computeScenarioRows(db, orgId, storeId, new Date(), variants);

  // 3. Filter -> 4. sort -> 5. paginate, all in memory; `total` is exact.
  const filtered = applyInMemoryFilters(computed, filters);
  const sorted = sortComputedRows(filtered, filters.sortBy);
  const total = sorted.length;
  const start = (filters.page - 1) * filters.perPage;
  const page = sorted.slice(start, start + filters.perPage);

  return { data: page.map((c) => c.row), total };
}

// ─── Quote ────────────────────────────────────────────────────────────────────

/** The quote wire breakdown built from the engine statement (buildStatementBreakdown) -- all Decimal fields become strings. */
export interface QuoteBreakdown {
  listGross: string;
  sellerDiscountGross: string;
  saleGross: string;
  saleVat: string;
  costGross: string;
  costVat: string;
  commissionGross: string;
  commissionVat: string;
  shippingGross: string;
  shippingVat: string;
  platformServiceGross: string;
  platformServiceVat: string;
  stoppage: string;
  netVat: string;
  netProfit: string;
  saleMarginPct: string | null;
  costMarkupPct: string | null;
  // Grup toplamları — "satış nereye gitti" tahsisini besler (frontend para toplamaz).
  // marketplaceFees = totalDeductions − cost − taxes (komisyon + kargo + PSF + mikro
  // ihracat DEBIT/CREDIT'in net'i; dökümde ayrı kova olmayan uluslararası
  // ücretler de böylece dahil olur ve gruplar HER ZAMAN satışa toplanır).
  marketplaceFeesGross: string;
  // taxes = stopaj + net KDV.
  taxesGross: string;
  // totalDeductions = satış − net kâr (tanım gereği; grup çubuğunun kalanı = kâr).
  totalDeductionsGross: string;
}

export type QuoteResult =
  | {
      calculable: true;
      variantId: string;
      price: string;
      priceDelta: string;
      breakdown: QuoteBreakdown;
    }
  | { calculable: false; variantId: string; reason: QuoteReason };

/** Input to `quoteProductPrice` — the target after Zod parsing. */
export interface QuoteServiceInput {
  variantId: string;
  target: { type: 'margin' | 'markup' | 'profit'; value: string };
}

/**
 * Maps the scenario solver's failure reason onto the quote wire reason set. A Record,
 * not a switch chain: the solver's NOT_COMPUTABLE (no price produced a computable
 * statement -- cost/commission/shipping missing) is the quote's NOT_CALCULABLE; its
 * other failures already match the wire names.
 */
const SCENARIO_FAILURE_TO_QUOTE_REASON: Record<ScenarioSolveFailure, QuoteReason> = {
  NOT_COMPUTABLE: 'NOT_CALCULABLE',
  NO_COST: 'NO_COST',
  UNREACHABLE_TARGET: 'UNREACHABLE_TARGET',
  NOT_PRICE_SENSITIVE: 'NOT_PRICE_SENSITIVE',
};

/** Translates the quote request target into the scenario solver's target shape. */
function toScenarioTarget(target: QuoteServiceInput['target']): ScenarioPriceTarget {
  const value = new Decimal(target.value);
  switch (target.type) {
    case 'margin':
      return { kind: 'MARGIN', pct: value };
    case 'markup':
      return { kind: 'MARKUP', pct: value };
    case 'profit':
      return { kind: 'PROFIT', amount: value };
    default: {
      const _exhaustive: never = target.type;
      throw new Error(`Unhandled quote target type: ${_exhaustive}`);
    }
  }
}

/**
 * Builds the quote `QuoteBreakdown` from a solved scenario statement. The scenario
 * prices its units with no seller discount, so the list price `buildStatementBreakdown`
 * derives from the SALE line is the scenario sale and the seller discount is zero. It
 * folds every selected line into the four display groups (margins at four decimals for
 * the quote screen); the result is projected onto the quote wire shape, which carries
 * combined shipping and no export/return rows (a domestic scenario never produces them).
 * Returns null only when the statement carries no net profit, which the solver's
 * success already rules out.
 */
export function quoteBreakdownFromStatement(params: {
  readonly statement: ProfitStatement;
}): QuoteBreakdown | null {
  const breakdown = buildStatementBreakdown({
    totals: statementTotalsFromStatement(params.statement),
    selectedLines: params.statement.selectedLines,
    marginDecimals: 4,
  });
  if (breakdown === null) {
    return null;
  }
  return {
    listGross: breakdown.listGross,
    sellerDiscountGross: breakdown.sellerDiscountGross,
    saleGross: breakdown.saleGross,
    saleVat: breakdown.saleVat,
    costGross: breakdown.costGross,
    costVat: breakdown.costVat,
    commissionGross: breakdown.commissionGross,
    commissionVat: breakdown.commissionVat,
    shippingGross: breakdown.shippingGross,
    shippingVat: breakdown.shippingVat,
    platformServiceGross: breakdown.platformServiceGross,
    platformServiceVat: breakdown.platformServiceVat,
    stoppage: breakdown.stoppage,
    netVat: breakdown.netVat,
    netProfit: breakdown.netProfit,
    saleMarginPct: breakdown.saleMarginPct,
    costMarkupPct: breakdown.costMarkupPct,
    marketplaceFeesGross: breakdown.marketplaceFeesGross,
    taxesGross: breakdown.taxesGross,
    totalDeductionsGross: breakdown.totalDeductionsGross,
  };
}

/**
 * Solves for the sale price that achieves a given margin / markup / profit target for a
 * single variant with the scenario engine. Throws `InvalidReferenceError` (422) if the
 * variant does not exist in this store. Returns `{ calculable: false }` with a reason
 * when cost is missing (gate) or the solver finds no price.
 *
 * Decision 5 (plan): no margin/profit target is ever solved against a missing cost. The
 * cost gate reads the SAME view the list does -- the loaded scenario base -- rather than
 * the profile count `fetchCostAggregates` returns, so list and quote agree: a profile
 * without a version is dropped by the loader and raises MISSING_COST on both. After the
 * base loads ready, the scenario is probed once at `COST_PROBE_UNIT_PRICE` (the seller
 * cost lines do not move with the price, the cost version is chosen by the scenario
 * date), and a MISSING_COST issue rejects as NO_COST before the solver runs.
 *
 * `db` is injected (the route passes the shared client); the path is read-only, so it
 * runs as plain reads with no interactive transaction.
 */
export async function quoteProductPrice(
  db: Prisma.TransactionClient,
  orgId: string,
  storeId: string,
  input: QuoteServiceInput,
): Promise<QuoteResult> {
  // 1. Fetch the variant (must belong to this store).
  // Only the current sale price is needed here (for the signed priceDelta); the
  // scenario base carries everything else. A store-scoped miss is a 422.
  let variant: { salePrice: Prisma.Decimal };
  try {
    const raw = await db.productVariant.findFirst({
      where: { id: input.variantId, organizationId: orgId, storeId },
      select: { salePrice: true },
    });
    if (raw === null) {
      throw new InvalidReferenceError('ProductVariant', input.variantId);
    }
    variant = raw;
  } catch (err) {
    if (err instanceof InvalidReferenceError) throw err;
    mapPrismaError(err);
  }

  // 2. Load the scenario base (scenario date = now).
  const now = new Date();
  const bases = await loadTrendyolScenarioBases(db, {
    organizationId: orgId,
    storeId,
    scenarioDate: now,
    variants: [{ variantId: input.variantId }],
  });
  const loaded = bases.get(input.variantId);
  if (loaded === undefined || loaded.kind !== 'ready') {
    // The variant was just found store-scoped above, so a non-ready base is defensive.
    return { calculable: false, variantId: input.variantId, reason: 'NOT_CALCULABLE' };
  }

  // 3. Cost gate (decision 5) read from the loaded base, so it matches the list.
  // Probe the scenario at a zero unit price: the cost does not depend on the price, so a
  // MISSING_COST here is exactly the one the list raises. Reject as NO_COST before the
  // solver, so a margin/profit target is never solved against a missing cost.
  const { statement: probe } = evaluateTrendyolScenario({
    ...loaded.base,
    unitPrice: COST_PROBE_UNIT_PRICE,
  });
  if (probe.issues.some((issue) => issue.code === ProfitIssueCode.MISSING_COST)) {
    return { calculable: false, variantId: input.variantId, reason: 'NO_COST' };
  }

  // 4. Solve, then build the breakdown at the solved price.
  const solved = solveTrendyolScenarioPrice({
    base: loaded.base,
    target: toScenarioTarget(input.target),
  });
  if (!solved.ok) {
    return {
      calculable: false,
      variantId: input.variantId,
      reason: SCENARIO_FAILURE_TO_QUOTE_REASON[solved.reason],
    };
  }

  const breakdown = quoteBreakdownFromStatement({ statement: solved.statement });
  if (breakdown === null) {
    return { calculable: false, variantId: input.variantId, reason: 'NOT_CALCULABLE' };
  }

  return {
    calculable: true,
    variantId: input.variantId,
    price: solved.unitPrice.toFixed(2),
    // Signed change vs the current list price (solved - current). Negative when the
    // target lowers the price. Computed here (backend) -- the frontend never does money
    // math, it only renders this value. formatMoney2 normalizes a signed zero ("-0.00")
    // to a plain "0.00".
    priceDelta: formatMoney2(solved.unitPrice.sub(variant.salePrice.toString())),
    breakdown,
  };
}

// ─── Serialization ────────────────────────────────────────────────────────────

/** The display fields of a row, shared by the computed and the degraded paths. */
type RowDisplayFields = Omit<
  ProductPricingRow,
  'calculable' | 'netProfit' | 'saleMarginPct' | 'costMarkupPct'
>;

/**
 * Maps a SHIPPING_ESTIMATE_UNAVAILABLE issue's `detail` (a ShippingUnavailableReason)
 * to the wire ShippingEstimateStatus. A Record keyed by the reason union, so a new
 * reason is a compile error here until it is placed. UNKNOWN_DESI surfaces as NO_DESI
 * (defensive: the scenario desi has a 0 floor, so it is never returned in practice).
 */
const SHIPPING_DETAIL_TO_STATUS: Record<ShippingUnavailableReason, ShippingEstimateStatus> = {
  UNKNOWN_DESI: 'NO_DESI',
  NO_CARRIER: 'NO_CARRIER',
  DESI_OVERFLOW: 'DESI_OVERFLOW',
  OWN_CONTRACT_EMPTY: 'OWN_CONTRACT_EMPTY',
};

/**
 * The ShippingEstimateStatus a SHIPPING_ESTIMATE_UNAVAILABLE issue implies, read from
 * its detail through the Record above. The engine always sets the detail to a mapped
 * reason; an unexpected value degrades defensively to NO_CARRIER so the row still
 * renders. `Object.entries` keeps the lookup type-safe without an assertion.
 */
function shippingStatusFromDetail(detail: string | null): ShippingEstimateStatus {
  for (const [reason, status] of Object.entries(SHIPPING_DETAIL_TO_STATUS)) {
    if (reason === detail) {
      return status;
    }
  }
  return 'NO_CARRIER';
}

/** The three independent wire statuses implied by an evaluated scenario's issues. */
interface ScenarioStatuses {
  costStatus: CostStatus;
  shippingStatus: ShippingEstimateStatus;
  commissionStatus: CommissionStatus;
}

/**
 * Reads the three independent statuses from a statement's issues. A missing cost line
 * raises MISSING_COST (-> NO_PROFILES), a missing commission rate raises
 * MISSING_COMMISSION_RATE (-> NO_RULE) and an unresolvable shipping tariff raises
 * SHIPPING_ESTIMATE_UNAVAILABLE (its detail -> the shipping status). The absence of a
 * kind of issue leaves that status OK, so a digital variant (which raises no shipping
 * issue) reads shippingStatus OK and stays calculable.
 */
function statusesFromIssues(issues: readonly ProfitIssue[]): ScenarioStatuses {
  let costStatus: CostStatus = 'OK';
  let shippingStatus: ShippingEstimateStatus = 'OK';
  let commissionStatus: CommissionStatus = 'OK';
  for (const issue of issues) {
    switch (issue.code) {
      case ProfitIssueCode.MISSING_COST:
        costStatus = 'NO_PROFILES';
        break;
      case ProfitIssueCode.MISSING_COMMISSION_RATE:
        commissionStatus = 'NO_RULE';
        break;
      case ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE:
        shippingStatus = shippingStatusFromDetail(issue.detail);
        break;
      // Settlement-only codes: a scenario never raises them, so they leave the three
      // statuses unchanged. A blocking one would still leave netProfit null (the row
      // reads uncalculable) without mapping onto one of these three inputs.
      case ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD:
      case ProfitIssueCode.AMBIGUOUS_RECORD_MATCH:
        break;
      // Order-carrier warnings: they come from an order's own carrier (a scenario has no
      // order carrier) and are non-blocking -- the shipping line still exists -- so they
      // leave the three statuses unchanged.
      case ProfitIssueCode.CARRIER_NOT_RECOGNIZED:
      case ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE:
        break;
      default: {
        const _exhaustive: never = issue.code;
        throw new Error(`Unhandled profit issue code: ${_exhaustive}`);
      }
    }
  }
  return { costStatus, shippingStatus, commissionStatus };
}

/**
 * Builds a row's display fields (everything but the profit metrics). `cost` is the
 * statement's gross cost when costStatus is OK and null otherwise; `imageUrl` is the
 * first product image or null; category / brand ids are serialized bigints.
 */
function buildRowDisplayFields(
  variant: VariantForListRow,
  statuses: ScenarioStatuses,
  cost: string | null,
): RowDisplayFields {
  const { product } = variant;
  return {
    variantId: variant.id,
    sku: variant.stockCode,
    barcode: variant.barcode,
    productName: product.title,
    salePrice: new Decimal(variant.salePrice.toString()).toFixed(2),
    costStatus: statuses.costStatus,
    shippingEstimateStatus: statuses.shippingStatus,
    commissionStatus: statuses.commissionStatus,
    imageUrl: product.imageUrls[0] ?? null,
    cost,
    categoryId: product.categoryId !== null ? product.categoryId.toString() : null,
    categoryName: product.categoryName,
    brandId: product.brandId !== null ? product.brandId.toString() : null,
    brandName: product.brandName,
  };
}

/** A not-calculable `ComputedPricingRow` from display fields: empty profit, null metrics. */
function notCalculableRow(display: RowDisplayFields): ComputedPricingRow {
  return {
    row: {
      ...display,
      calculable: false,
      netProfit: null,
      saleMarginPct: null,
      costMarkupPct: null,
    },
    netProfit: null,
    saleMarginPct: null,
    costMarkupPct: null,
  };
}

/**
 * A degraded row: profit could not be computed (store-wide loader failure, an
 * unavailable base, or a per-variant evaluation error). The profit metrics stay empty
 * and the three statuses default to OK -- with no statement there is no issue to
 * surface. The caller logs the failure (decision 9).
 */
function degradedRow(variant: VariantForListRow): ComputedPricingRow {
  const display = buildRowDisplayFields(
    variant,
    { costStatus: 'OK', shippingStatus: 'OK', commissionStatus: 'OK' },
    null,
  );
  return notCalculableRow(display);
}

/**
 * A zero-priced row: the variant's sale price is 0, which is not a price, so it is not
 * scored (owner decision 2026-11-10). The profit metrics stay empty, the three statuses
 * read OK because an unpriced variant's inputs are not checked at all, and cost is not
 * surfaced. Not a failure -- nothing is logged. (The quote still evaluates such a
 * variant, so list and quote agree only for priced variants.)
 */
function noPriceRow(variant: VariantForListRow): ComputedPricingRow {
  const display = buildRowDisplayFields(
    variant,
    { costStatus: 'OK', shippingStatus: 'OK', commissionStatus: 'OK' },
    null,
  );
  return notCalculableRow(display);
}

/**
 * Turns one variant's evaluated scenario statement into a `ComputedPricingRow` -- the
 * serialized DTO row PLUS the un-rounded Decimal profit metrics the in-memory
 * filter/sort consume. The three statuses come from the statement's issues; `cost` is
 * the statement's gross cost when cost resolved. When the statement carries a net
 * profit the row is calculable and the metrics come straight from it; otherwise the
 * profit fields are null.
 */
function computeRowFromStatement(
  variant: VariantForListRow,
  statement: ProfitStatement,
): ComputedPricingRow {
  const statuses = statusesFromIssues(statement.issues);
  const cost = statuses.costStatus === 'OK' ? formatMoney2(statement.costGross) : null;
  const display = buildRowDisplayFields(variant, statuses, cost);

  const calculable = deriveCalculable(
    statuses.costStatus,
    statuses.shippingStatus,
    statuses.commissionStatus,
  );
  const netProfit = statement.netProfit;
  if (!calculable || netProfit === null) {
    return notCalculableRow(display);
  }

  return {
    row: {
      ...display,
      calculable: true,
      netProfit: formatMoney2(netProfit),
      saleMarginPct: formatMarginPct2(statement.saleMarginPct),
      costMarkupPct: formatMarginPct2(statement.costMarkupPct),
    },
    netProfit,
    saleMarginPct: statement.saleMarginPct,
    costMarkupPct: statement.costMarkupPct,
  };
}
