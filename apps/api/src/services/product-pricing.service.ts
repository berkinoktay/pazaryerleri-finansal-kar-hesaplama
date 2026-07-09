// Assembly service for the Ürün Fiyatlandırma (product pricing) backend.
//
// Builds one `UnitEconomics` per approved ProductVariant by composing the
// EXISTING resolvers — no new financial logic lives here:
//   - cost           → fetchCostAggregates (raw-SQL batch, GROSS-TRY)
//   - commission     → resolveCommissionRate (platform-global rate, percent)
//   - commission VAT → resolveFeeDefinition(COMMISSION_INVOICE).defaultVatRate
//   - stoppage       → resolveFeeDefinition(STOPPAGE).rateOfSale  (FRACTION)
//   - shipping fee   → estimateShippingCostForVariant            (NET → GROSS)
//   - PSF fee        → resolveFeeDefinition(PLATFORM_SERVICE).fixedAmountNet
//
// then calls Dilim 1's pure `computeUnitProfit`. All financial math stays in
// the backend (feedback_no_frontend_financial_calculation); the frontend only
// renders the serialized strings.
//
// Unit conventions (grounding §0, CRITICAL): saleVatRate / commissionRate /
// commissionVatRate / shipVat / psfVat are PERCENTS (20, 18); stoppageRate is a
// FRACTION (0.01 — do NOT /100); cost + fixedFees are GROSS (VAT-inclusive).
//
// Rows are ALWAYS returned, calculable or not, so the user sees which input is
// missing. A variant is calculable only when cost, shipping AND commission are
// all OK (deriveCalculable). When not calculable, profit/margin fields are null.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Platform, Prisma, Store as PrismaStore } from '@pazarsync/db';
import {
  computeUnitProfit,
  grossToVat,
  resolveFeeDefinition,
  solvePriceForTarget,
  type EstimateOutcome,
  type EstimateUnavailableReason,
  type ProfitBreakdown,
  type ProfitInputFee,
  type SolveReason,
  type UnitEconomics,
} from '@pazarsync/profit';

// Quote-level failure reason — superset of the engine's SolveReason.
// NOT_CALCULABLE is quote-only: cost is OK here but shipping or commission is
// missing, so the engine cannot be invoked at all.
export type QuoteReason = SolveReason | 'NOT_CALCULABLE';
import { InvalidReferenceError, mapPrismaError } from '@pazarsync/sync-core';

import { resolveCommissionRate, type ResolvedCommissionRate } from './commission-rate-resolver';
import { feeToProfitInputFee, deriveCalculable } from './product-pricing-assembly';
import { fetchCostAggregates } from './products-list.service';
import { estimateShippingCostForVariant } from './shipping-estimator.service';
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
    images: { url: string }[];
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

  // ─── cost (GROSS-TRY batch aggregate; VAT extracted at sale rate) ───────────
  // A null `currentCostTry` (e.g. FX_MISSING) never pairs with costStatus 'OK',
  // but we read it directly so the type narrows without an assertion.
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

/** Variant fields the batch commission resolver reads. */
interface VariantForCommission {
  id: string;
  product: { categoryId: bigint | null; brandId: bigint | null };
}

/**
 * Resolves the commission rate for every variant with at most one
 * `resolveCommissionRate` call per UNIQUE `(categoryId, brandId)` pair — the
 * rate is platform-global, so two variants in the same category+brand share a
 * result. Variants with a null `categoryId` cannot match any rule and map to
 * `null` without a resolver call.
 *
 * Returns a `Map<variantId, ResolvedCommissionRate | null>` covering every input
 * variant. Same-pair variants receive the SAME resolved reference, so the dedupe
 * is observable both by call count and by reference identity.
 */
export async function batchResolveCommission(
  platform: Platform,
  variants: VariantForCommission[],
): Promise<Map<string, ResolvedCommissionRate | null>> {
  // Unique pairs keyed by a stable string; null categoryId never enters the pool.
  const pairKey = (categoryId: bigint, brandId: bigint | null): string =>
    `${categoryId.toString()}|${brandId === null ? '' : brandId.toString()}`;

  const uniquePairs = new Map<string, { categoryId: bigint; brandId: bigint | null }>();
  for (const variant of variants) {
    const { categoryId, brandId } = variant.product;
    if (categoryId === null) continue;
    const key = pairKey(categoryId, brandId);
    if (!uniquePairs.has(key)) {
      uniquePairs.set(key, { categoryId, brandId });
    }
  }

  // Resolve each unique pair exactly once (in parallel).
  const resolvedByKey = new Map<string, ResolvedCommissionRate | null>();
  await Promise.all(
    [...uniquePairs.entries()].map(async ([key, pair]) => {
      const resolved = await resolveCommissionRate({
        platform,
        categoryId: pair.categoryId,
        brandId: pair.brandId,
        // Trendyol does not expose a seller's segment via API — always null today.
        sellerSegment: null,
      });
      resolvedByKey.set(key, resolved);
    }),
  );

  // Map every variant back to its pair's result (null categoryId ⇒ null).
  const result = new Map<string, ResolvedCommissionRate | null>();
  for (const variant of variants) {
    const { categoryId, brandId } = variant.product;
    if (categoryId === null) {
      result.set(variant.id, null);
      continue;
    }
    result.set(variant.id, resolvedByKey.get(pairKey(categoryId, brandId)) ?? null);
  }
  return result;
}

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

/** Builds the SQL `where` for the candidate set: org + store + approved + cheap filters. */
function buildListWhere(
  orgId: string,
  storeId: string,
  filters: ListProductPricingFilters,
): Prisma.ProductVariantWhereInput {
  const productWhere: Prisma.ProductWhereInput = { approved: true };
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
 * Lists per-variant forward pricing for a store's APPROVED products. Computes
 * EVERY candidate variant's profit in memory (batch resolvers — no N+1), then
 * filters / sorts / paginates IN MEMORY so the profit/margin sorts and the
 * profit/margin filters operate on the live computed values and `total` is the
 * exact filtered count. Calculability is reported per row so the user can see
 * and fix the gaps. `imageUrl` / `cost` / category + brand names are included.
 */
export async function listProductPricing(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  filters: ListProductPricingFilters,
): Promise<{ data: ProductPricingRow[]; total: number }> {
  const where = buildListWhere(orgId, storeId, filters);

  // 1. Candidate set — ALL approved variants matching the cheap SQL filters.
  //    No skip/take here: the full set must be computed before in-memory
  //    filter/sort/paginate can produce a correct `total`.
  let variants: VariantForListRow[];
  try {
    variants = await prisma.productVariant.findMany({
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
            images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 },
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

  const variantIds = variants.map((v) => v.id);

  // 2. Batch-resolve all three per-variant inputs up front (one query each) so
  //    the per-variant assembly below is a pure in-memory loop — no N+1.
  const [costByVariantId, commissionByVariantId, shippingByVariantId] = await Promise.all([
    fetchCostAggregates(orgId, variantIds),
    batchResolveCommission(store.platform, variants),
    batchResolveShipping(orgId, storeId, variantIds),
  ]);

  // 3. Compute every variant in memory. Fee definitions are loop-invariant —
  //    resolved once inside a transaction.
  const computed = await prisma.$transaction(async (tx) => {
    const feeDefs = await resolveFeeDefs(tx, store.platform);
    const ctx: AssemblyContext = { platform: store.platform, feeDefs };

    return variants.map((variant): ComputedPricingRow => {
      const costAggregate = costByVariantId.get(variant.id);
      const result = assembleUnitEconomics(ctx, variant, {
        costAggregate,
        commission: commissionByVariantId.get(variant.id) ?? null,
        shipping: shippingByVariantId.get(variant.id) ?? { ok: false, reason: 'STORE_NOT_FOUND' },
      });
      return computeRow(variant, result, costAggregate);
    });
  });

  // 4. Filter → 5. sort → 6. paginate, all in memory; `total` is exact.
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
 * Solves for the sale price that achieves a given margin / markup / profit
 * target for a single variant. Throws `InvalidReferenceError` (422) if the
 * variant does not exist in this store. Returns `{ calculable: false }` when
 * cost is missing or the target is unreachable.
 *
 * Decision §5 (plan): if costStatus !== 'OK', reject before calling the motor
 * to avoid returning a price based on cost=0 for margin/profit targets.
 */
export async function quoteProductPrice(
  tx: Prisma.TransactionClient,
  orgId: string,
  storeId: string,
  store: PrismaStore,
  input: QuoteServiceInput,
): Promise<QuoteResult> {
  // ─── 1. Fetch the variant (must belong to this store) ────────────────────
  let variant: VariantForAssembly;
  try {
    const raw = await tx.productVariant.findFirst({
      where: { id: input.variantId, organizationId: orgId, storeId },
      select: {
        id: true,
        stockCode: true,
        barcode: true,
        salePrice: true,
        vatRate: true,
        isDigital: true,
        product: { select: { title: true, categoryId: true, brandId: true } },
      },
    });
    if (raw === null) {
      throw new InvalidReferenceError('ProductVariant', input.variantId);
    }
    variant = raw;
  } catch (err) {
    if (err instanceof InvalidReferenceError) throw err;
    mapPrismaError(err);
  }

  // ─── 2. Maliyet kapısı (karar §5) ────────────────────────────────────────
  // Reject before calling the solver when cost is unavailable. Margin/profit
  // targets would "solve" with cost=0 and produce incorrect results.
  const costMap = await fetchCostAggregates(orgId, [input.variantId]);
  const costAggregate = costMap.get(input.variantId);
  const costStatus = costAggregate?.costStatus ?? 'NO_PROFILES';

  if (costStatus !== 'OK') {
    return { calculable: false, variantId: input.variantId, reason: 'NO_COST' };
  }

  // ─── 3. Resolve the per-variant inputs, then assemble ────────────────────
  // Single variant: resolve commission + shipping directly (one call each),
  // exactly as the old in-assembly path did, then run the pure assembly. The
  // commission resolver is skipped when categoryId is null (no possible match);
  // shipping uses the canonical per-variant estimator (CTE-equivalent).
  const feeDefs = await resolveFeeDefs(tx, store.platform);
  const ctx: AssemblyContext = { platform: store.platform, feeDefs };

  const commission =
    variant.product.categoryId !== null
      ? await resolveCommissionRate({
          platform: store.platform,
          categoryId: variant.product.categoryId,
          brandId: variant.product.brandId,
          // Trendyol does not expose a seller's segment via API — always null today.
          sellerSegment: null,
        })
      : null;
  const shipping = await estimateShippingCostForVariant(variant.id, tx);

  const assemblyResult = assembleUnitEconomics(ctx, variant, {
    costAggregate,
    commission,
    shipping,
  });

  if (assemblyResult.econ === null) {
    // Cost is guaranteed OK here (the gate above returned 'NO_COST' otherwise),
    // so econ is null only because shipping or commission is not available.
    return { calculable: false, variantId: input.variantId, reason: 'NOT_CALCULABLE' };
  }

  // ─── 4. Solve ────────────────────────────────────────────────────────────
  const solveResult = solvePriceForTarget(assemblyResult.econ, {
    type: input.target.type,
    value: new Decimal(input.target.value),
  });

  if (!solveResult.calculable) {
    return { calculable: false, variantId: input.variantId, reason: solveResult.reason };
  }

  return {
    calculable: true,
    variantId: input.variantId,
    price: solveResult.price.toFixed(2),
    // Signed change vs the current list price (solved − current). Negative when
    // the target lowers the price. Computed here (backend) — the frontend never
    // does money math, it only renders this value.
    priceDelta: solveResult.price.sub(variant.salePrice.toString()).toFixed(2),
    breakdown: serializeBreakdown(solveResult.breakdown),
  };
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Builds a `ComputedPricingRow` — the serialized DTO row PLUS the un-rounded
 * Decimal profit metrics the in-memory filter/sort consume. `cost` is the GROSS
 * TRY aggregate, present only when costStatus is OK (it is null otherwise, even
 * if a stale FX value sits in `currentCostTry`). `imageUrl` is the position-0
 * product image url or null. category / brand ids are serialized bigints.
 */
function computeRow(
  variant: VariantForListRow,
  result: AssemblyResult,
  costAggregate: VariantCostAggregate | undefined,
): ComputedPricingRow {
  const { product } = variant;
  const imageUrl = product.images[0]?.url ?? null;
  const cost =
    result.costStatus === 'OK' && costAggregate?.currentCostTry != null
      ? costAggregate.currentCostTry
      : null;

  const displayFields = {
    imageUrl,
    cost,
    categoryId: product.categoryId !== null ? product.categoryId.toString() : null,
    categoryName: product.categoryName,
    brandId: product.brandId !== null ? product.brandId.toString() : null,
    brandName: product.brandName,
  };

  const base = {
    variantId: variant.id,
    sku: variant.stockCode,
    barcode: variant.barcode,
    productName: product.title,
    salePrice: new Decimal(variant.salePrice.toString()).toFixed(2),
    costStatus: result.costStatus,
    shippingEstimateStatus: result.shippingStatus,
    commissionStatus: result.commissionStatus,
    ...displayFields,
  };

  if (result.econ === null) {
    return {
      row: {
        ...base,
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

  const breakdown = computeUnitProfit(result.econ, new Decimal(variant.salePrice.toString()));
  return {
    row: {
      ...base,
      calculable: true,
      netProfit: breakdown.netProfit.toFixed(2),
      saleMarginPct: breakdown.saleMarginPct !== null ? breakdown.saleMarginPct.toFixed(2) : null,
      costMarkupPct: breakdown.costMarkupPct !== null ? breakdown.costMarkupPct.toFixed(2) : null,
    },
    netProfit: breakdown.netProfit,
    saleMarginPct: breakdown.saleMarginPct,
    costMarkupPct: breakdown.costMarkupPct,
  };
}
