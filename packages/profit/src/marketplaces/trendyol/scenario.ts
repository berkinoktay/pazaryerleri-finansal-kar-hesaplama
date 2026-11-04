import { Decimal } from 'decimal.js';
import { ShippingTariffSource } from '@pazarsync/db/enums';
import { getBusinessDate, type ResolvedProfitSettings } from '@pazarsync/utils';

import { computeProfitStatement, type ProfitStatement } from '../../core/profit-statement';
import {
  solveScenarioPrice,
  type ScenarioPriceTarget,
  type ScenarioSolveResult,
} from '../../core/scenario/solve-scenario-price';
import { type ItemCostProfileInput } from '../../core/seller-costs/build-seller-cost-lines';
import { ceilToKurus, floorToKurus, KURUS_DECIMALS, ONE_KURUS } from '../../money';
import {
  estimateTrendyolParcel,
  type EstimateResult,
  type TrendyolEstimateInput,
} from './estimate-parcel';
import { type ResolvedTrendyolCommissionRate } from './resolve-commission-rate';
import {
  type TrendyolCommissionBand,
  type TrendyolItemAttributes,
  type TrendyolReferenceData,
} from './trendyol-inputs';

const ZERO = new Decimal(0);

/** The lowest unit price a scenario solve considers unless the caller raises it. */
const DEFAULT_SCENARIO_MIN_UNIT_PRICE = new Decimal('0.01');

/** The parcel id of the hypothetical scenario parcel. */
export const TRENDYOL_SCENARIO_PARCEL_ID = 'scenario';
/** The single order-item id of the hypothetical scenario parcel. */
export const TRENDYOL_SCENARIO_ITEM_ID = 'scenario-item';

/** The product a scenario prices: everything the parcel and the commission chain need. */
export interface TrendyolScenarioProduct {
  readonly variantId: string;
  readonly barcode: string | null;
  readonly saleVatRatePct: Decimal;
  readonly unitDesi: Decimal | null;
  readonly isDigital: boolean;
  readonly categoryId: string | null;
  readonly brandId: string | null;
  readonly syncedCommissionRatePct: Decimal | null;
  readonly tariffBands: readonly TrendyolCommissionBand[] | null; // tariff covering the scenario date
}

/** A single scenario question: this product, at this unit price, under these settings. */
export interface TrendyolScenarioInput {
  readonly product: TrendyolScenarioProduct;
  readonly unitPrice: Decimal; // seller's unit sale price, VAT incl., kurus; a campaign passes the seller-effective price
  readonly quantity: number; // integer >= 1; basket scenarios pass n
  readonly commissionRatePctOverride: Decimal | null; // a screen that prices a given band or plus rate
  readonly scenarioDate: Date; // cost version and reference date
  readonly fastDelivery: boolean; // Barem eligibility, computed by the loader
  readonly isExportSale: boolean;
  readonly reference: TrendyolReferenceData;
  readonly costs: readonly ItemCostProfileInput[];
  readonly settings: ResolvedProfitSettings;
}

/** The scenario question without its unit price; the price axis the solver varies. */
export type TrendyolScenarioBase = Omit<TrendyolScenarioInput, 'unitPrice'>;

/**
 * The estimate lines, the profit statement and the commission rate of one evaluated
 * scenario. `commission` is the rate and source the scenario actually used, so a
 * screen can show it even when the commission nets to zero and carries no COMMISSION
 * line; it is null only when no rate could be resolved (MISSING_COMMISSION_RATE).
 */
export interface TrendyolScenarioResult {
  readonly estimate: EstimateResult;
  readonly statement: ProfitStatement;
  readonly commission: ResolvedTrendyolCommissionRate | null;
}

/**
 * Throws `RangeError` unless the unit price is a non-negative kurus amount. Zero is a
 * valid scenario (a free item): the sale is zero while the cost and fees still deduct.
 * A negative price and a price with more than two decimals are rejected.
 */
function assertScenarioUnitPrice(unitPrice: Decimal): void {
  if (!unitPrice.isFinite() || unitPrice.lt(ZERO) || unitPrice.decimalPlaces() > KURUS_DECIMALS) {
    throw new RangeError(
      'scenario unitPrice must be a non-negative amount with at most two decimals',
    );
  }
}

/**
 * The single scenario item's commission attributes. The screen's explicit rate rides
 * on `commissionRatePctOverride` (applied verbatim, zero included); a scenario never
 * carries an order-line rate, so with no override the resolver walks the tariff,
 * synced and category chain.
 */
function scenarioItemAttributes(input: TrendyolScenarioInput): TrendyolItemAttributes {
  const { product } = input;
  return {
    orderItemId: TRENDYOL_SCENARIO_ITEM_ID,
    commissionRatePctOverride: input.commissionRatePctOverride,
    orderCommissionRatePct: null,
    tariffBands: product.tariffBands,
    syncedCommissionRatePct: product.syncedCommissionRatePct,
    categoryId: product.categoryId,
    brandId: product.brandId,
  };
}

/**
 * Builds the hypothetical one-item parcel the Phase 2A module estimates. The sale is
 * `unitPrice x quantity` with no seller discount; the product's VAT rate, desi and
 * digital flag ride on the item, and its commission chain (the override, the tariff
 * bands, the synced rate and the category/brand ids) rides on the item attributes.
 * No rule is re-implemented here; `estimateTrendyolParcel` validates the snapshot
 * (quantity included) and resolves every amount.
 */
export function buildTrendyolScenarioParcel(input: TrendyolScenarioInput): TrendyolEstimateInput {
  assertScenarioUnitPrice(input.unitPrice);
  const { product } = input;
  const saleGross = input.unitPrice.mul(input.quantity);

  return {
    snapshot: {
      parcelId: TRENDYOL_SCENARIO_PARCEL_ID,
      orderDate: input.scenarioDate,
      businessDate: getBusinessDate(input.scenarioDate),
      isCancelled: false,
      isExportSale: input.isExportSale,
      measuredDesi: null,
      items: [
        {
          orderItemId: TRENDYOL_SCENARIO_ITEM_ID,
          productVariantId: product.variantId,
          barcode: product.barcode,
          quantity: input.quantity,
          listGross: saleGross,
          sellerDiscountGross: ZERO,
          saleGross,
          saleVatRatePct: product.saleVatRatePct,
          unitDesi: product.unitDesi,
          isDigital: product.isDigital,
          isCancelled: false,
        },
      ],
    },
    attributes: {
      fastDelivery: input.fastDelivery,
      fastDeliveryType: null,
      actualShipDate: null,
      usesSellerCargoAgreement: false,
      items: [scenarioItemAttributes(input)],
    },
    reference: input.reference,
    costs: [{ orderItemId: TRENDYOL_SCENARIO_ITEM_ID, profiles: input.costs }],
    acceptedReturns: [],
  };
}

/**
 * Estimates the scenario parcel and ties its lines into a profit statement under the
 * store's settings, exactly as a real estimated order does. No commission rate is
 * resolved here, so the price solver, which only needs the statement, pays nothing
 * for the rate it does not read.
 */
function computeScenarioStatement(input: TrendyolScenarioInput): {
  readonly estimate: EstimateResult;
  readonly statement: ProfitStatement;
} {
  const estimate = estimateTrendyolParcel(buildTrendyolScenarioParcel(input));
  const statement = computeProfitStatement({
    lines: estimate.lines,
    view: 'ESTIMATE',
    settings: input.settings,
    isExportSale: input.isExportSale,
    isCancelled: false,
    isExcluded: false,
    issues: estimate.issues,
  });
  return { estimate, statement };
}

/**
 * Evaluates one scenario: the estimate, the profit statement, and the commission rate
 * the estimate resolved. The rate comes straight from the estimate's per-item map, the
 * single resolution point, so it matches the COMMISSION line when there is one and is
 * still reported when the commission nets to zero or is unresolvable (null).
 */
export function evaluateTrendyolScenario(input: TrendyolScenarioInput): TrendyolScenarioResult {
  const { estimate, statement } = computeScenarioStatement(input);
  const commission = estimate.commissionByItem.get(TRENDYOL_SCENARIO_ITEM_ID) ?? null;
  return { estimate, statement, commission };
}

/**
 * Whether the scenario's shipping can switch across Barem bands on the price axis:
 * a physical item on a fast delivery, under a Trendyol-contract carrier that supports
 * Barem, with a known desi that stays within the carrier's Barem desi limit.
 */
function isBaremBreakpointEligible(base: TrendyolScenarioBase): boolean {
  const { product } = base;
  if (product.isDigital || !base.fastDelivery) {
    return false;
  }

  const shipping = base.reference.shipping;
  if (shipping.source !== ShippingTariffSource.TRENDYOL_CONTRACT) {
    return false;
  }

  const carrier = shipping.carrier;
  if (carrier === null || !carrier.supportsBarem || product.unitDesi === null) {
    return false;
  }

  return product.unitDesi.mul(base.quantity).lte(carrier.maxBaremDesi);
}

/** Positive, ascending, value-unique copy of the breakpoint candidates. */
function sortedUniquePositive(values: readonly Decimal[]): Decimal[] {
  const positive = values.filter((value) => value.gt(ZERO)).sort((a, b) => a.cmp(b));

  const unique: Decimal[] = [];
  let previous: Decimal | null = null;
  for (const value of positive) {
    if (previous === null || !previous.equals(value)) {
      unique.push(value);
      previous = value;
    }
  }
  return unique;
}

/**
 * The unit prices where the Trendyol regime changes on the price axis, for the price
 * solver to split the axis at. Barem breakpoints (only when the scenario is Barem
 * eligible) map each basket band `[min, max]` onto the unit price by the quantity:
 * `ceilToKurus(min / quantity)` starts a band, `floorToKurus(max / quantity) + 0.01`
 * leaves it. Commission breakpoints (only without an override and with tariff bands)
 * add each band's `ceilToKurus(lowerLimit)` and `floorToKurus(upperLimit) + 0.01`, so
 * every evaluated price lands on a kurus. The result is positive, ascending and
 * value-unique.
 */
export function trendyolScenarioBreakpoints(base: TrendyolScenarioBase): readonly Decimal[] {
  const quantity = new Decimal(base.quantity);
  const candidates: Decimal[] = [];

  if (isBaremBreakpointEligible(base)) {
    for (const band of base.reference.shipping.baremBands) {
      candidates.push(ceilToKurus(band.minOrderAmount.div(quantity)));
      candidates.push(floorToKurus(band.maxOrderAmount.div(quantity)).add(ONE_KURUS));
    }
  }

  if (base.commissionRatePctOverride === null && base.product.tariffBands !== null) {
    for (const band of base.product.tariffBands) {
      if (band.lowerLimit !== null) {
        candidates.push(ceilToKurus(band.lowerLimit));
      }
      if (band.upperLimit !== null) {
        candidates.push(floorToKurus(band.upperLimit).add(ONE_KURUS));
      }
    }
  }

  return sortedUniquePositive(candidates);
}

/**
 * Finds the lowest unit price at which this product's scenario meets `target`
 * (a margin, a markup or an absolute net profit), or the reason none does. It
 * only wires the scenario to the marketplace-agnostic solver: the solver drives
 * the price, `evaluateTrendyolScenario` scores each one, and
 * `trendyolScenarioBreakpoints` tells the solver where the shipping or commission
 * regime changes on the price axis. No binary search and no pricing rule live
 * here. `minUnitPrice` defaults to one kurus; `maxUnitPrice` defaults to unbounded.
 */
export function solveTrendyolScenarioPrice(params: {
  readonly base: TrendyolScenarioBase;
  readonly target: ScenarioPriceTarget;
  readonly minUnitPrice?: Decimal;
  readonly maxUnitPrice?: Decimal | null;
}): ScenarioSolveResult {
  const { base, target } = params;
  return solveScenarioPrice({
    evaluate: (unitPrice) => computeScenarioStatement({ ...base, unitPrice }).statement,
    breakpoints: trendyolScenarioBreakpoints(base),
    target,
    minUnitPrice: params.minUnitPrice ?? DEFAULT_SCENARIO_MIN_UNIT_PRICE,
    maxUnitPrice: params.maxUnitPrice ?? null,
  });
}
