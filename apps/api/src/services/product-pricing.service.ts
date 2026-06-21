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
  type EstimateUnavailableReason,
  type ProfitInputFee,
  type UnitEconomics,
} from '@pazarsync/profit';
import { mapPrismaError } from '@pazarsync/sync-core';

import { resolveCommissionRate } from './commission-rate-resolver';
import { feeToProfitInputFee, deriveCalculable } from './product-pricing-assembly';
import { fetchCostAggregates } from './products-list.service';
import { estimateShippingCostForVariant } from './shipping-estimator.service';
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

export interface ListProductPricingFilters {
  page: number;
  perPage: number;
  q?: string;
  sortBy?: ProductPricingSort;
}

export type ProductPricingSort = 'salePrice:asc' | 'salePrice:desc' | 'title:asc' | 'title:desc';

// ─── Fee definitions resolved once per request (loop-invariant) ───────────────

interface ResolvedFeeDefs {
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
async function resolveFeeDefs(
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

// ─── Assembly ─────────────────────────────────────────────────────────────────

/**
 * Builds a variant's `UnitEconomics` and the three independent status codes.
 * `econ` is non-null only when cost, shipping and commission are all OK; in any
 * other case it is `null` (the caller turns that into a not-calculable row).
 *
 * `costAggregate` is looked up upstream (batch); shipping + commission are
 * per-variant DB calls (N+1 accepted at perPage ≤ 100 — see plan §Kararlar 2).
 */
export async function assembleUnitEconomics(
  tx: Prisma.TransactionClient,
  ctx: AssemblyContext,
  variant: VariantForAssembly,
  costAggregate: VariantCostAggregate | undefined,
): Promise<AssemblyResult> {
  const saleVatRate = new Decimal(variant.vatRate ?? DEFAULT_VAT_RATE);

  // ─── cost (GROSS-TRY batch aggregate; VAT extracted at sale rate) ───────────
  // A null `currentCostTry` (e.g. FX_MISSING) never pairs with costStatus 'OK',
  // but we read it directly so the type narrows without an assertion.
  const costStatus: CostStatus = costAggregate?.costStatus ?? 'NO_PROFILES';
  const currentCostTry = costAggregate?.currentCostTry ?? null;
  const costGross =
    costStatus === 'OK' && currentCostTry !== null ? new Decimal(currentCostTry) : null;

  // ─── commission (platform-global rate; null ⇒ NO_RULE) ──────────────────────
  // categoryId is required to match a rule — null means no possible match, so we
  // skip the resolver entirely and report NO_RULE directly.
  let commissionStatus: CommissionStatus = 'NO_RULE';
  let commissionRate: Decimal | null = null;
  if (variant.product.categoryId !== null) {
    const resolved = await resolveCommissionRate({
      platform: ctx.platform,
      categoryId: variant.product.categoryId,
      brandId: variant.product.brandId,
      // Trendyol does not expose a seller's segment via API — always null today.
      sellerSegment: null,
    });
    if (resolved !== null) {
      commissionStatus = 'OK';
      commissionRate = resolved.rate;
    }
  }

  // ─── shipping (NET tariff → GROSS DEBIT fee) ────────────────────────────────
  const shippingOutcome = await estimateShippingCostForVariant(variant.id, tx);
  let shippingStatus: ShippingEstimateStatus;
  let shippingFee: ProfitInputFee | null = null;
  if (shippingOutcome.ok) {
    shippingStatus = 'OK';
    shippingFee = feeToProfitInputFee(
      shippingOutcome.estimate.amount,
      ctx.feeDefs.shipVatRate,
      'SHIPPING',
    );
  } else {
    shippingStatus = shippingReasonToStatus(shippingOutcome.reason);
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

function buildOrderBy(
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
    case undefined:
      // Stable default: cheapest first, then id to break ties deterministically.
      return { salePrice: 'asc' };
    default: {
      const _exhaustive: never = sort;
      throw new Error(`Unhandled product pricing sort: ${_exhaustive}`);
    }
  }
}

// ─── List entry point ─────────────────────────────────────────────────────────

/**
 * Lists per-variant forward pricing for a store's APPROVED products. Every
 * matching variant yields a row; calculability is reported per row so the user
 * can see and fix the gaps.
 */
export async function listProductPricing(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  filters: ListProductPricingFilters,
): Promise<{ data: ProductPricingRow[]; total: number }> {
  const where: Prisma.ProductVariantWhereInput = {
    organizationId: orgId,
    storeId,
    product: { approved: true },
    ...(filters.q !== undefined ? buildSearchWhere(filters.q) : {}),
  };

  const skip = (filters.page - 1) * filters.perPage;

  let variants: VariantForAssembly[];
  let total: number;
  try {
    [variants, total] = await Promise.all([
      prisma.productVariant.findMany({
        where,
        select: {
          id: true,
          stockCode: true,
          barcode: true,
          salePrice: true,
          vatRate: true,
          isDigital: true,
          product: { select: { title: true, categoryId: true, brandId: true } },
        },
        orderBy: [buildOrderBy(filters.sortBy), { id: 'asc' }],
        take: filters.perPage,
        skip,
      }),
      prisma.productVariant.count({ where }),
    ]);
  } catch (err) {
    mapPrismaError(err);
  }

  if (variants.length === 0) {
    return { data: [], total };
  }

  const variantIds = variants.map((v) => v.id);
  const costByVariantId = await fetchCostAggregates(orgId, variantIds);

  // Shipping + commission resolvers need a transaction client; the fee
  // definitions are resolved once inside the same transaction.
  const data = await prisma.$transaction(async (tx) => {
    const feeDefs = await resolveFeeDefs(tx, store.platform);
    const ctx: AssemblyContext = { platform: store.platform, feeDefs };

    const rows: ProductPricingRow[] = [];
    for (const variant of variants) {
      const result = await assembleUnitEconomics(tx, ctx, variant, costByVariantId.get(variant.id));
      rows.push(toRow(variant, result));
    }
    return rows;
  });

  return { data, total };
}

// ─── Serialization ────────────────────────────────────────────────────────────

function toRow(variant: VariantForAssembly, result: AssemblyResult): ProductPricingRow {
  const base = {
    variantId: variant.id,
    sku: variant.stockCode,
    barcode: variant.barcode,
    productName: variant.product.title,
    salePrice: new Decimal(variant.salePrice.toString()).toFixed(2),
    costStatus: result.costStatus,
    shippingEstimateStatus: result.shippingStatus,
    commissionStatus: result.commissionStatus,
  };

  if (result.econ === null) {
    return {
      ...base,
      calculable: false,
      netProfit: null,
      saleMarginPct: null,
      costMarkupPct: null,
    };
  }

  const breakdown = computeUnitProfit(result.econ, new Decimal(variant.salePrice.toString()));
  return {
    ...base,
    calculable: true,
    netProfit: breakdown.netProfit.toFixed(2),
    saleMarginPct: breakdown.saleMarginPct !== null ? breakdown.saleMarginPct.toFixed(2) : null,
    costMarkupPct: breakdown.costMarkupPct !== null ? breakdown.costMarkupPct.toFixed(2) : null,
  };
}
