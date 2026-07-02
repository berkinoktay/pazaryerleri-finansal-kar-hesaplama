// Profit computation for the saved Plus Commission Tariffs feature.
//
// Like the product commission tariff, this REUSES the Ürün Fiyatlandırma assembly
// (`assembleUnitEconomics` + `computeUnitProfit`) and overrides only the
// commission — no financial math is re-implemented. The difference: instead of a
// 4-band ladder, each Plus item has exactly TWO scenarios:
//   • CURRENT — the seller's current price @ their current commission (e.g. 19%).
//   • PLUS    — the Trendyol Plus price CEILING (or the seller's custom Plus
//               price ≤ ceiling) @ the reduced Plus commission (e.g. 15.4%).
// The Plus deal requires DROPPING the price to the ceiling to earn the lower
// commission (confirmed from the seller panel), so the value proposition is
// whether the lower price + lower commission nets more than the status quo —
// `plusIsBetter`. Profit is optimistic (a what-if), like every estimate here.

import { Decimal } from 'decimal.js';

import { computeUnitProfit, type EstimateOutcome, type UnitEconomics } from '@pazarsync/profit';

import {
  assembleUnitEconomics,
  serializeBreakdown,
  type AssemblyInputs,
  type QuoteBreakdown,
} from './product-pricing.service';
import {
  deriveReason,
  tariffCommission,
  type TariffAssemblyContext,
  type TariffItemReason,
  type TariffVariant,
} from './tariff-compute-commons';
import type { VariantCostAggregate } from '../validators/product.validator';

// ─── Inputs the compute reads off one persisted item ────────────────────────

export interface PlusItemInputs {
  readonly currentPrice: Decimal;
  readonly currentCommissionPct: Decimal;
  readonly plusPriceUpperLimit: Decimal;
  readonly plusCommissionPct: Decimal;
  /** Seller's optional override of the Plus price (≤ ceiling); null = the ceiling. */
  readonly customPrice: Decimal | null;
}

// ─── Result shapes (serialized — strings, never float) ──────────────────────

export interface ComputedScenario {
  /** Gross sale price (TRY) this scenario is computed at. */
  readonly price: string;
  /** Commission PERCENT as stored (e.g. "19", "15.4"). */
  readonly commissionPct: string;
  readonly netProfit: string | null;
  readonly marginPct: string | null;
}

export interface ComputedPlusItem {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  readonly current: ComputedScenario;
  readonly plus: ComputedScenario;
  /** True when the Plus scenario nets strictly more profit than the current one. */
  readonly plusIsBetter: boolean;
}

/** The gross price the Plus scenario uses: the seller's custom price, else the ceiling. */
function plusPrice(inputs: PlusItemInputs): Decimal {
  return inputs.customPrice ?? inputs.plusPriceUpperLimit;
}

function nullScenario(price: Decimal, commissionPct: Decimal): ComputedScenario {
  return {
    price: price.toFixed(2),
    commissionPct: commissionPct.toString(),
    netProfit: null,
    marginPct: null,
  };
}

/** Runs the engine at one (price, commission) over a shared base econ. */
function computeScenario(
  baseEcon: UnitEconomics,
  price: Decimal,
  commissionPct: Decimal,
): { scenario: ComputedScenario; netProfit: Decimal } {
  const econ: UnitEconomics = { ...baseEcon, commissionRate: commissionPct };
  const breakdown = computeUnitProfit(econ, price);
  return {
    scenario: {
      price: price.toFixed(2),
      commissionPct: commissionPct.toString(),
      netProfit: breakdown.netProfit.toFixed(2),
      marginPct: breakdown.saleMarginPct !== null ? breakdown.saleMarginPct.toFixed(2) : null,
    },
    netProfit: breakdown.netProfit,
  };
}

/**
 * Computes the current + Plus scenarios for one item. `variant` is null for an
 * unmatched barcode → not calculable (NO_PRODUCT). Otherwise the econ is probed
 * once (cost/shipping/PSF/VAT are commission-invariant); if non-null, each
 * scenario overrides only `commissionRate` and runs at its own price.
 */
export function computePlusItem(
  ctx: TariffAssemblyContext,
  inputs: PlusItemInputs,
  variant: TariffVariant | null,
  costAggregate: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
): ComputedPlusItem {
  const pPrice = plusPrice(inputs);
  if (variant === null) {
    return {
      calculable: false,
      reason: 'NO_PRODUCT',
      current: nullScenario(inputs.currentPrice, inputs.currentCommissionPct),
      plus: nullScenario(pPrice, inputs.plusCommissionPct),
      plusIsBetter: false,
    };
  }

  const probeInputs: AssemblyInputs = {
    costAggregate,
    commission: tariffCommission(inputs.currentCommissionPct),
    shipping,
  };
  const probe = assembleUnitEconomics(ctx, variant, probeInputs);

  if (probe.econ === null) {
    return {
      calculable: false,
      reason: deriveReason(probe.costStatus === 'OK', probe.shippingStatus === 'OK'),
      current: nullScenario(inputs.currentPrice, inputs.currentCommissionPct),
      plus: nullScenario(pPrice, inputs.plusCommissionPct),
      plusIsBetter: false,
    };
  }

  const current = computeScenario(probe.econ, inputs.currentPrice, inputs.currentCommissionPct);
  const plus = computeScenario(probe.econ, pPrice, inputs.plusCommissionPct);

  return {
    calculable: true,
    reason: null,
    current: current.scenario,
    plus: plus.scenario,
    plusIsBetter: plus.netProfit.gt(current.netProfit),
  };
}

// ─── Single-price estimate (custom-price what-if under the Plus commission) ──

export interface ComputedPlusEstimate {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  /** The Plus commission percent applied (e.g. "15.4"); null when not calculable at all. */
  readonly commissionPct: string | null;
  /** Full serialized profit breakdown at `price`; null when not calculable. */
  readonly breakdown: QuoteBreakdown | null;
}

/**
 * Computes the full profit breakdown for ONE Plus item at an arbitrary price
 * under its reduced Plus commission (the free-form what-if the detail modal
 * drives). Same assembly + not-calculable semantics as `computePlusItem`.
 */
export function computePlusEstimate(
  ctx: TariffAssemblyContext,
  inputs: Pick<PlusItemInputs, 'currentCommissionPct' | 'plusCommissionPct'>,
  variant: TariffVariant | null,
  costAggregate: VariantCostAggregate | undefined,
  shipping: EstimateOutcome,
  price: Decimal,
): ComputedPlusEstimate {
  if (variant === null) {
    return { calculable: false, reason: 'NO_PRODUCT', commissionPct: null, breakdown: null };
  }

  const probeInputs: AssemblyInputs = {
    costAggregate,
    commission: tariffCommission(inputs.currentCommissionPct),
    shipping,
  };
  const probe = assembleUnitEconomics(ctx, variant, probeInputs);

  if (probe.econ === null) {
    return {
      calculable: false,
      reason: deriveReason(probe.costStatus === 'OK', probe.shippingStatus === 'OK'),
      commissionPct: inputs.plusCommissionPct.toString(),
      breakdown: null,
    };
  }

  const econ: UnitEconomics = { ...probe.econ, commissionRate: inputs.plusCommissionPct };
  return {
    calculable: true,
    reason: null,
    commissionPct: inputs.plusCommissionPct.toString(),
    breakdown: serializeBreakdown(computeUnitProfit(econ, price)),
  };
}
