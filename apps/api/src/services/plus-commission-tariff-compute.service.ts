// Profit computation for the saved Plus Commission Tariffs feature.
//
// Like the product commission tariff, this REUSES the Ürün Fiyatlandırma assembly
// (`assembleUnitEconomics` + `computeUnitProfit`) and overrides only the
// commission — no financial math is re-implemented. The difference: instead of a
// 4-band ladder, each Plus item has exactly TWO scenarios:
//   • CURRENT — the seller's current price @ their current commission (e.g. 19%).
//   • PLUS    — the Trendyol Plus price CEILING @ the reduced Plus commission
//               (e.g. 15.4%). ALWAYS the ceiling: a committed custom Plus price is
//               a separate what-if that NEVER enters this on-read compute — the
//               offer card is a pure ceiling option. The custom price is written by
//               the export and priced free-form by the estimate endpoint instead.
// The Plus deal requires DROPPING the price to the ceiling to earn the lower
// commission (confirmed from the seller panel), so the value proposition is
// whether the lower ceiling price + lower commission nets more than the status
// quo — `plusIsBetter` compares the CEILING scenario against the current one.
// Profit is optimistic (a what-if), like every estimate here.

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
  /** Güncel TSF (the seller's current sale price) — echoed on the wire, not priced. */
  readonly currentPrice: Decimal;
  /**
   * Komisyona Esas Fiyat — the customer-seen price commission is charged on. The
   * current ("do nothing") scenario is priced HERE (schema NOT NULL, so there is no
   * sale-price fallback), matching the product commission tariff's #400 semantics.
   */
  readonly commissionBasePrice: Decimal;
  readonly currentCommissionPct: Decimal;
  readonly plusPriceUpperLimit: Decimal;
  readonly plusCommissionPct: Decimal;
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

/**
 * The "do nothing" baseline: net profit + sale margin at the commission-base price
 * under the current commission. Price + commission are echoed from the item on the
 * wire, so only the computed figures live here — mirrors the product commission
 * tariff's flattened current scenario.
 */
export interface ComputedCurrentScenario {
  readonly netProfit: string | null;
  readonly marginPct: string | null;
}

export interface ComputedPlusItem {
  readonly calculable: boolean;
  readonly reason: TariffItemReason | null;
  readonly current: ComputedCurrentScenario;
  readonly plus: ComputedScenario;
  /** True when the Plus scenario nets strictly more profit than the current one. */
  readonly plusIsBetter: boolean;
}

const NULL_CURRENT: ComputedCurrentScenario = { netProfit: null, marginPct: null };

/**
 * The gross price the Plus offer scenario is computed at: ALWAYS the ceiling. A
 * committed custom price is deliberately NOT read here — the offer card is a pure
 * ceiling option; the custom price is exported and priced by the estimate endpoint.
 */
function plusPrice(inputs: PlusItemInputs): Decimal {
  return inputs.plusPriceUpperLimit;
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
function runScenario(
  baseEcon: UnitEconomics,
  price: Decimal,
  commissionPct: Decimal,
): { netProfit: Decimal; marginPct: Decimal | null } {
  const econ: UnitEconomics = { ...baseEcon, commissionRate: commissionPct };
  const breakdown = computeUnitProfit(econ, price);
  return { netProfit: breakdown.netProfit, marginPct: breakdown.saleMarginPct };
}

/**
 * Computes the current + Plus scenarios for one item. `variant` is null for an
 * unmatched barcode → not calculable (NO_PRODUCT). Otherwise the econ is probed
 * once (cost/shipping/PSF/VAT are commission-invariant); if non-null, the current
 * scenario runs at the commission-base price under the current commission and the
 * Plus scenario at the CEILING price under the reduced commission (a committed
 * custom price never enters here — see `plusPrice`).
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
      current: NULL_CURRENT,
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
      current: NULL_CURRENT,
      plus: nullScenario(pPrice, inputs.plusCommissionPct),
      plusIsBetter: false,
    };
  }

  const baseEcon: UnitEconomics = probe.econ;

  // Baseline ("do nothing"): the current commission at the COMMISSION-BASE price —
  // the customer-seen price commission is actually charged on, NOT the sale price.
  const current = runScenario(baseEcon, inputs.commissionBasePrice, inputs.currentCommissionPct);
  const plus = runScenario(baseEcon, pPrice, inputs.plusCommissionPct);

  return {
    calculable: true,
    reason: null,
    current: {
      netProfit: current.netProfit.toFixed(2),
      marginPct: current.marginPct !== null ? current.marginPct.toFixed(2) : null,
    },
    plus: {
      price: pPrice.toFixed(2),
      commissionPct: inputs.plusCommissionPct.toString(),
      netProfit: plus.netProfit.toFixed(2),
      marginPct: plus.marginPct !== null ? plus.marginPct.toFixed(2) : null,
    },
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
 * under a GIVEN commission percent (the caller picks the scenario's commission:
 * current or Plus). This is the free-form what-if the detail modal drives. Same
 * assembly + not-calculable semantics as `computePlusItem`. Commission is applied
 * as a PERCENT, exactly like the detail scenarios.
 */
export function computePlusEstimate(
  ctx: TariffAssemblyContext,
  applyCommissionPct: Decimal,
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
    commission: tariffCommission(applyCommissionPct),
    shipping,
  };
  const probe = assembleUnitEconomics(ctx, variant, probeInputs);

  if (probe.econ === null) {
    return {
      calculable: false,
      reason: deriveReason(probe.costStatus === 'OK', probe.shippingStatus === 'OK'),
      commissionPct: applyCommissionPct.toString(),
      breakdown: null,
    };
  }

  const econ: UnitEconomics = { ...probe.econ, commissionRate: applyCommissionPct };
  return {
    calculable: true,
    reason: null,
    commissionPct: applyCommissionPct.toString(),
    breakdown: serializeBreakdown(computeUnitProfit(econ, price)),
  };
}
