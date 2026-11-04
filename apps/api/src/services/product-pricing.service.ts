// Service for the product pricing backend.
//
// The list and the quote price every variant with the shared scenario engine
// (`@pazarsync/profit`): `loadTrendyolScenarioBases` reads cost, commission, tariff,
// fee and shipping inputs for the whole page in a constant number of queries, then
// `evaluateTrendyolScenario` scores each variant at its sale price and
// `solveTrendyolScenarioPrice` finds the price for a quote target. All financial math
// lives in the engine (feedback_no_frontend_financial_calculation); this service only
// maps the engine's statement onto the wire and never re-implements a formula.
//
// Rows are ALWAYS returned, calculable or not, so the user sees which input is
// missing. The three independent statuses are read from the statement's issues
// (MISSING_COST -> NO_PROFILES, SHIPPING_ESTIMATE_UNAVAILABLE -> the shipping status,
// MISSING_COMMISSION_RATE -> NO_RULE); a variant is calculable only when all three are
// OK (deriveCalculable). When not calculable, profit/margin fields are null.
//
// `assembleUnitEconomics` + `serializeBreakdown` below are the LEGACY unit-engine
// helpers, no longer used by the list/quote but still consumed by the remaining
// scenario screens until Faz 4B Tasks 5-8 move them to the engine.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Platform, Prisma } from '@pazarsync/db';
import { ProfitIssueCode } from '@pazarsync/db/enums';
import {
  buildStatementBreakdown,
  evaluateTrendyolScenario,
  grossToVat,
  loadTrendyolScenarioBases,
  resolveFeeDefinition,
  roundPercent,
  solveTrendyolScenarioPrice,
  statementTotalsFromStatement,
  UnsupportedPlatformError,
  type EstimateOutcome,
  type EstimateUnavailableReason,
  type ProfitBreakdown,
  type ProfitInputFee,
  type ProfitIssue,
  type ProfitStatement,
  type ScenarioLoadResult,
  type ScenarioPriceTarget,
  type ScenarioSolveFailure,
  type ShippingUnavailableReason,
  type SolveReason,
  type UnitEconomics,
} from '@pazarsync/profit';

// Quote-level failure reason — superset of the engine's SolveReason.
// NOT_CALCULABLE is quote-only: cost is OK here but shipping or commission is
// missing, so the engine cannot be invoked at all.
export type QuoteReason = SolveReason | 'NOT_CALCULABLE';
import { InvalidReferenceError, mapPrismaError } from '@pazarsync/sync-core';

import { type ResolvedCommissionRate } from './commission-rate-resolver';
import { feeToProfitInputFee, deriveCalculable } from './product-pricing-assembly';
import { logProfitReadFailure } from './profit-compute-fallback.service';
import { SHIPPING_ESTIMATE_CTE_SQL, type ShippingEstimateRow } from './shipping-estimator.sql';
import type {
  CommissionStatus,
  CostStatus,
  ProductPricingRow,
  ShippingEstimateStatus,
} from './product-pricing.types';
import type { VariantCostAggregate } from '../validators/product.validator';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Trendyol default sale VAT rate (percent) when a variant carries no override. */
const DEFAULT_VAT_RATE = 20;

/**
 * The unit price the quote probes the loaded base at to read whether the cost resolved.
 * Zero is a valid scenario (Faz 4B Task 1: a free item still deducts its cost and fees),
 * and the seller cost lines do not depend on the price, so a MISSING_COST at zero is
 * exactly the one the list raises -- the probe lets list and quote agree.
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

// ─── Fee definitions resolved once per request (loop-invariant) ───────────────

export interface ResolvedFeeDefs {
  /** Komisyon KDV oranı, yüzde (örn. 20). */
  commissionVatRate: Decimal;
  /** Stopaj oranı — NET satış üstüne KESİR (örn. 0.01). */
  stoppageRate: Decimal;
  /** PSF (Platform Hizmet Bedeli) NET sabit tutar. */
  psfNet: Decimal;
  /** PSF KDV oranı, yüzde. */
  psfVatRate: Decimal;
  /** Kargo KDV oranı, yüzde. */
  shipVatRate: Decimal;
}

/** Variant shape consumed by the assembly — exactly the columns we read. */
interface VariantForAssembly {
  id: string;
  stockCode: string;
  barcode: string;
  salePrice: Prisma.Decimal;
  vatRate: number | null;
  isDigital: boolean;
  product: { title: string; categoryId: bigint | null; brandId: bigint | null };
}

/**
 * Variant shape for the LIST pipeline — the assembly columns plus the display
 * fields (category/brand names + primary image) the list rows surface. A
 * superset of `VariantForAssembly`, so it can be passed straight to
 * `assembleUnitEconomics` and the batch commission resolver.
 */
interface VariantForListRow extends VariantForAssembly {
  product: {
    title: string;
    categoryId: bigint | null;
    categoryName: string | null;
    brandId: bigint | null;
    brandName: string | null;
    imageUrls: string[];
  };
}

interface AssemblyContext {
  platform: Platform;
  feeDefs: ResolvedFeeDefs;
}

interface AssemblyResult {
  econ: UnitEconomics | null;
  costStatus: CostStatus;
  shippingStatus: ShippingEstimateStatus;
  commissionStatus: CommissionStatus;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Maps a shipping estimate failure reason to the wire `ShippingEstimateStatus`.
 * `STORE_NOT_FOUND` cannot occur here (the store is verified by
 * `requireStoreAccess` before this runs) — mapped defensively to NO_CARRIER so
 * the row degrades gracefully rather than throwing. Exhaustive over the union.
 */
function shippingReasonToStatus(reason: EstimateUnavailableReason): ShippingEstimateStatus {
  switch (reason) {
    case 'NO_CARRIER':
      return 'NO_CARRIER';
    case 'DESI_OVERFLOW':
      return 'DESI_OVERFLOW';
    case 'OWN_CONTRACT_EMPTY':
      return 'OWN_CONTRACT_EMPTY';
    case 'STORE_NOT_FOUND':
      return 'NO_CARRIER';
    default: {
      const _exhaustive: never = reason;
      throw new Error(`Unhandled shipping estimate reason: ${_exhaustive}`);
    }
  }
}

/**
 * Resolves the four loop-invariant FeeDefinitions ONCE per request (single
 * `now`). COMMISSION_INVOICE/SHIPPING contribute only their VAT rate; STOPPAGE
 * its rateOfSale (fraction); PLATFORM_SERVICE its net fixed amount + VAT rate.
 */
export async function resolveFeeDefs(
  tx: Prisma.TransactionClient,
  platform: Platform,
): Promise<ResolvedFeeDefs> {
  const now = new Date();
  const [commissionDef, stoppageDef, psfDef, shipDef] = await Promise.all([
    resolveFeeDefinition(tx, { platform, feeType: 'COMMISSION_INVOICE', at: now }),
    resolveFeeDefinition(tx, { platform, feeType: 'STOPPAGE', at: now }),
    resolveFeeDefinition(tx, { platform, feeType: 'PLATFORM_SERVICE', at: now }),
    resolveFeeDefinition(tx, { platform, feeType: 'SHIPPING', at: now }),
  ]);

  if (stoppageDef.rateOfSale === null) {
    throw new Error(`STOPPAGE FeeDefinition ${stoppageDef.id} missing rateOfSale`);
  }
  if (psfDef.fixedAmountNet === null) {
    throw new Error(`PLATFORM_SERVICE FeeDefinition ${psfDef.id} missing fixedAmountNet`);
  }

  return {
    commissionVatRate: new Decimal(commissionDef.defaultVatRate),
    stoppageRate: new Decimal(stoppageDef.rateOfSale),
    psfNet: new Decimal(psfDef.fixedAmountNet),
    psfVatRate: new Decimal(psfDef.defaultVatRate),
    shipVatRate: new Decimal(shipDef.defaultVatRate),
  };
}

// ─── Pre-resolved inputs (batch-friendly) ────────────────────────────────────

/**
 * The three per-variant inputs `assembleUnitEconomics` needs, resolved UPSTREAM
 * so the assembly stays pure (no DB). `quoteProductPrice` resolves these for one
 * variant; `listProductPricing` resolves them in batch (one query each) across
 * the whole page — that is how the N+1 is removed without changing the math.
 */
export interface AssemblyInputs {
  costAggregate: VariantCostAggregate | undefined;
  commission: ResolvedCommissionRate | null;
  shipping: EstimateOutcome;
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

// Legacy: kept until the remaining scenario screens move to the engine (Faz 4B Tasks 5-8).
/**
 * Builds a variant's `UnitEconomics` and the three independent status codes.
 * `econ` is non-null only when cost, shipping and commission are all OK; in any
 * other case it is `null` (the caller turns that into a not-calculable row).
 *
 * PURE — performs no DB queries. All three resolver-backed inputs (cost,
 * commission, shipping) are supplied via `inputs`, resolved upstream in batch by
 * the caller. The unit math (percent vs fraction, NET → GROSS) is unchanged from
 * the previous per-variant version; only WHERE the inputs come from changed.
 */
export function assembleUnitEconomics(
  ctx: AssemblyContext,
  variant: VariantForAssembly,
  inputs: AssemblyInputs,
): AssemblyResult {
  const saleVatRate = new Decimal(variant.vatRate ?? DEFAULT_VAT_RATE);

  // ─── cost (GROSS-TL batch aggregate; VAT extracted at sale rate) ───────────
  // A null `currentCostTry` never pairs with costStatus 'OK' (NO_PROFILES), but
  // we read it directly so the type narrows without an assertion.
  const costStatus: CostStatus = inputs.costAggregate?.costStatus ?? 'NO_PROFILES';
  const currentCostTry = inputs.costAggregate?.currentCostTry ?? null;
  const costGross =
    costStatus === 'OK' && currentCostTry !== null ? new Decimal(currentCostTry) : null;

  // ─── commission (platform-global rate; null ⇒ NO_RULE) ──────────────────────
  // categoryId is required to match a rule — when there is no possible match the
  // caller passes `commission: null` (it skips the resolver), so a null here
  // means NO_RULE regardless of why.
  let commissionStatus: CommissionStatus = 'NO_RULE';
  let commissionRate: Decimal | null = null;
  if (inputs.commission !== null) {
    commissionStatus = 'OK';
    commissionRate = inputs.commission.rate;
  }

  // ─── shipping (NET tariff → GROSS DEBIT fee) ────────────────────────────────
  let shippingStatus: ShippingEstimateStatus;
  let shippingFee: ProfitInputFee | null = null;
  if (inputs.shipping.ok) {
    shippingStatus = 'OK';
    shippingFee = feeToProfitInputFee(
      inputs.shipping.estimate.amount,
      ctx.feeDefs.shipVatRate,
      'SHIPPING',
    );
  } else {
    shippingStatus = shippingReasonToStatus(inputs.shipping.reason);
  }

  const calculable = deriveCalculable(costStatus, shippingStatus, commissionStatus);
  if (!calculable || costGross === null || commissionRate === null || shippingFee === null) {
    return { econ: null, costStatus, shippingStatus, commissionStatus };
  }

  // ─── PSF (Platform Hizmet Bedeli) — skip for digital variants ───────────────
  // Catalog has no order context, so FAST PSF cannot be inferred — always the
  // standard PLATFORM_SERVICE tier (plan §Kararlar 4).
  const fixedFees: ProfitInputFee[] = [shippingFee];
  if (!variant.isDigital) {
    fixedFees.push(
      feeToProfitInputFee(ctx.feeDefs.psfNet, ctx.feeDefs.psfVatRate, 'PLATFORM_SERVICE'),
    );
  }

  const econ: UnitEconomics = {
    saleVatRate,
    cost: { gross: costGross, vat: grossToVat(costGross, saleVatRate) },
    commissionRate,
    commissionVatRate: ctx.feeDefs.commissionVatRate,
    stoppageRate: ctx.feeDefs.stoppageRate,
    fixedFees,
  };

  return { econ, costStatus, shippingStatus, commissionStatus };
}

// ─── Batch resolvers (one DB round-trip for the whole page) ───────────────────

/**
 * Maps a `ShippingEstimateRow` (from the CTE) back to the `EstimateOutcome`
 * shape `assembleUnitEconomics` consumes. The CTE already mirrors the canonical
 * `estimateShippingCostForVariant` (equivalence test guarantees agreement), so
 * this is a pure wire-shape adaptation — no recomputation.
 *
 * `NO_DESI` is unreachable in practice (`synced_dimensional_weight` is non-null
 * `@default(0)`, so the COALESCE'd desi is never NULL); it is mapped defensively
 * to `DESI_OVERFLOW` so the `EstimateOutcome` reason union stays closed.
 */
function shippingRowToOutcome(row: ShippingEstimateRow): EstimateOutcome {
  if (row.shipping_estimate_status === 'OK') {
    if (row.estimated_shipping_net === null || row.shipping_tariff_applied === null) {
      // Defensive: an 'OK' row always carries a net amount + applied tariff.
      return { ok: false, reason: 'DESI_OVERFLOW' };
    }
    return {
      ok: true,
      estimate: {
        amount: new Decimal(row.estimated_shipping_net),
        carrierCode: row.shipping_carrier_code ?? 'OWN',
        tariffApplied: row.shipping_tariff_applied,
        // The CTE selects only `price_net`, not the winning tariff row id — null
        // matches the OWN_CONTRACT branch of the per-variant estimator. Neither
        // field feeds the profit math (assembly reads only `amount`).
        sourceTariffId: null,
        baseDesiAtEstimate: new Decimal(row.eff_desi ?? '0'),
      },
    };
  }

  switch (row.shipping_estimate_status) {
    case 'NO_CARRIER':
      return { ok: false, reason: 'NO_CARRIER' };
    case 'OWN_CONTRACT_EMPTY':
      return { ok: false, reason: 'OWN_CONTRACT_EMPTY' };
    case 'DESI_OVERFLOW':
      return { ok: false, reason: 'DESI_OVERFLOW' };
    case 'NO_DESI':
      return { ok: false, reason: 'DESI_OVERFLOW' };
    default: {
      const _exhaustive: never = row.shipping_estimate_status;
      throw new Error(`Unhandled shipping estimate status: ${_exhaustive}`);
    }
  }
}

/**
 * Resolves shipping for every variant in a store with ONE query, reusing the
 * canonical `SHIPPING_ESTIMATE_CTE_SQL` (the same CTE products-list uses). The
 * CTE returns one row per variant in the (org, store) scope; we keep only the
 * requested `variantIds` and adapt each row to an `EstimateOutcome`. Variants
 * with no CTE row (e.g. STORE_NOT_FOUND) map to `STORE_NOT_FOUND`.
 */
export async function batchResolveShipping(
  organizationId: string,
  storeId: string,
  variantIds: string[],
): Promise<Map<string, EstimateOutcome>> {
  const result = new Map<string, EstimateOutcome>();
  if (variantIds.length === 0) return result;

  let rows: ShippingEstimateRow[];
  try {
    rows = await prisma.$queryRawUnsafe<ShippingEstimateRow[]>(
      SHIPPING_ESTIMATE_CTE_SQL,
      organizationId,
      storeId,
    );
  } catch (err) {
    mapPrismaError(err);
  }

  const requested = new Set(variantIds);
  for (const row of rows) {
    if (requested.has(row.id)) {
      result.set(row.id, shippingRowToOutcome(row));
    }
  }

  // Any requested variant the CTE did not return (no store join, etc.) degrades
  // to STORE_NOT_FOUND so the row stays present and not-calculable.
  for (const id of variantIds) {
    if (!result.has(id)) {
      result.set(id, { ok: false, reason: 'STORE_NOT_FOUND' });
    }
  }
  return result;
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
 * `Decimal | null`. The list pipeline computes EVERY approved variant in memory,
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

/** Builds the SQL `where` for the candidate set: org + store + cheap filters. */
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
 * its own `salePrice`, turning the engine's statement into a computed row. The tariff
 * anchor and the scenario date are both `now` (this screen prices at the current
 * instant). The query count is constant: `loadTrendyolScenarioBases` reads the store,
 * the variants and all reference data once, regardless of how many variants are passed.
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
      variants: variants.map((variant) => ({ variantId: variant.id, tariffAnchor: now })),
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

  // Collect per-variant evaluation failures (count + first error) and log them once
  // after the pass, so a systemic per-variant failure on a large list is one log line.
  let firstEvaluationError: unknown = null;
  let failedCount = 0;

  const rows = variants.map((variant): ComputedPricingRow => {
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
      if (failedCount === 0) {
        firstEvaluationError = err;
      }
      failedCount += 1;
      return degradedRow(variant);
    }
  });

  if (failedCount > 0) {
    logProfitReadFailure({
      surface: 'product-pricing',
      organizationId: orgId,
      orderId: null,
      err: firstEvaluationError,
      failedCount,
    });
  }

  return rows;
}

/**
 * Lists per-variant forward pricing for a store's APPROVED products. Computes
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

  // 1. Candidate set -- ALL approved variants matching the cheap SQL filters.
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

/** Serialized ProfitBreakdown — all Decimal fields become strings. */
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
  // ihracat DEBIT/CREDIT'in net'i; ProfitBreakdown'da ayrı kova olmayan uluslararası
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

// Legacy: kept until the remaining scenario screens move to the engine (Faz 4B Tasks 5-8).
export function serializeBreakdown(bd: ProfitBreakdown): QuoteBreakdown {
  // Grup toplamları Decimal ile burada hesaplanır (frontend para toplamaz).
  // totalDeductions'ı satış − kâr olarak türetmek, uluslararası/yurt dışı gibi
  // ayrı kovası olmayan ücretleri de otomatik yakalar → gruplar tam satışa toplanır.
  const taxesGross = bd.stoppage.add(bd.netVat);
  const totalDeductionsGross = bd.saleGross.sub(bd.netProfit);
  const marketplaceFeesGross = totalDeductionsGross.sub(bd.costGross).sub(taxesGross);
  return {
    listGross: bd.listGross.toFixed(2),
    sellerDiscountGross: bd.sellerDiscountGross.toFixed(2),
    saleGross: bd.saleGross.toFixed(2),
    saleVat: bd.saleVat.toFixed(2),
    costGross: bd.costGross.toFixed(2),
    costVat: bd.costVat.toFixed(2),
    commissionGross: bd.commissionGross.toFixed(2),
    commissionVat: bd.commissionVat.toFixed(2),
    shippingGross: bd.shippingGross.toFixed(2),
    shippingVat: bd.shippingVat.toFixed(2),
    platformServiceGross: bd.platformServiceGross.toFixed(2),
    platformServiceVat: bd.platformServiceVat.toFixed(2),
    stoppage: bd.stoppage.toFixed(2),
    netVat: bd.netVat.toFixed(2),
    netProfit: bd.netProfit.toFixed(2),
    saleMarginPct: bd.saleMarginPct !== null ? bd.saleMarginPct.toFixed(4) : null,
    costMarkupPct: bd.costMarkupPct !== null ? bd.costMarkupPct.toFixed(4) : null,
    marketplaceFeesGross: marketplaceFeesGross.toFixed(2),
    taxesGross: taxesGross.toFixed(2),
    totalDeductionsGross: totalDeductionsGross.toFixed(2),
  };
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
 * prices one unit with no seller discount, so `listGross` is the solved unit price and
 * the seller discount is zero. `buildStatementBreakdown` folds every selected line into
 * the four display groups (margins at four decimals for the quote screen); the result
 * is projected onto the quote wire shape, which carries combined shipping and no
 * export/return rows (a domestic scenario never produces them). Returns null only when
 * the statement carries no net profit, which the solver's success already rules out.
 */
export function quoteBreakdownFromStatement(params: {
  readonly statement: ProfitStatement;
  readonly listGross: Decimal;
  readonly sellerDiscountGross: Decimal;
}): QuoteBreakdown | null {
  const breakdown = buildStatementBreakdown({
    totals: statementTotalsFromStatement(params.statement),
    selectedLines: params.statement.selectedLines,
    listGross: params.listGross,
    sellerDiscountGross: params.sellerDiscountGross,
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

  // 2. Load the scenario base (tariff anchor + scenario date = now).
  const now = new Date();
  const bases = await loadTrendyolScenarioBases(db, {
    organizationId: orgId,
    storeId,
    scenarioDate: now,
    variants: [{ variantId: input.variantId, tariffAnchor: now }],
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

  const breakdown = quoteBreakdownFromStatement({
    statement: solved.statement,
    listGross: solved.unitPrice,
    sellerDiscountGross: new Decimal(0),
  });
  if (breakdown === null) {
    return { calculable: false, variantId: input.variantId, reason: 'NOT_CALCULABLE' };
  }

  return {
    calculable: true,
    variantId: input.variantId,
    price: solved.unitPrice.toFixed(2),
    // Signed change vs the current list price (solved - current). Negative when the
    // target lowers the price. Computed here (backend) -- the frontend never does money
    // math, it only renders this value.
    priceDelta: solved.unitPrice.sub(variant.salePrice.toString()).toFixed(2),
    breakdown,
  };
}

// ─── Serialization ────────────────────────────────────────────────────────────

/** The display fields of a row, shared by the computed and the degraded paths. */
type RowDisplayFields = Omit<
  ProductPricingRow,
  'calculable' | 'netProfit' | 'saleMarginPct' | 'costMarkupPct'
>;

/** A two-decimal money string (half-up), signed zero normalized to a plain zero. */
function money2(value: Decimal): string {
  const fixed = value.toFixed(2, Decimal.ROUND_HALF_UP);
  return fixed === '-0.00' ? '0.00' : fixed;
}

/**
 * A margin as a two-decimal string, rounded the way the stored statement rounds it
 * (roundPercent to the stored scale first, then two decimals) so the list renders the
 * same value the order list and the stored row do. Null stays null; signed zero is
 * normalized to a plain zero.
 */
function marginPct2(value: Decimal | null): string | null {
  if (value === null) {
    return null;
  }
  const fixed = roundPercent(value).toFixed(2, Decimal.ROUND_HALF_UP);
  return fixed === '-0.00' ? '0.00' : fixed;
}

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
  const cost = statuses.costStatus === 'OK' ? money2(statement.costGross) : null;
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
      netProfit: money2(netProfit),
      saleMarginPct: marginPct2(statement.saleMarginPct),
      costMarkupPct: marginPct2(statement.costMarkupPct),
    },
    netProfit,
    saleMarginPct: statement.saleMarginPct,
    costMarkupPct: statement.costMarkupPct,
  };
}
