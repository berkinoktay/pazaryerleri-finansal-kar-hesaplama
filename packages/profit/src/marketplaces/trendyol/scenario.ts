import { Decimal } from 'decimal.js';
import { ShippingTariffSource } from '@pazarsync/db/enums';
import { getBusinessDate, type ResolvedProfitSettings } from '@pazarsync/utils';

import { type FxRateQuote } from '../../core/fx/select-fx-rate';
import { type CurrencyCode } from '../../core/fx/currency-code';
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
import { type TrendyolCommissionBand, type TrendyolReferenceData } from './trendyol-inputs';

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
  readonly scenarioDate: Date; // cost version, FX and reference date
  readonly fastDelivery: boolean; // Barem eligibility, computed by the loader
  readonly isExportSale: boolean;
  readonly accountingCurrency: CurrencyCode;
  readonly reference: TrendyolReferenceData;
  readonly costs: readonly ItemCostProfileInput[];
  readonly fxQuotes: readonly FxRateQuote[];
  readonly settings: ResolvedProfitSettings;
}

/** The scenario question without its unit price; the price axis the solver varies. */
export type TrendyolScenarioBase = Omit<TrendyolScenarioInput, 'unitPrice'>;

/** The estimate lines and the profit statement of one evaluated scenario. */
export interface TrendyolScenarioResult {
  readonly estimate: EstimateResult;
  readonly statement: ProfitStatement;
}

/** Throws `RangeError` unless the unit price is a positive kurus amount. */
function assertScenarioUnitPrice(unitPrice: Decimal): void {
  if (!unitPrice.isFinite() || unitPrice.lte(ZERO) || unitPrice.decimalPlaces() > KURUS_DECIMALS) {
    throw new RangeError('scenario unitPrice must be a positive amount with at most two decimals');
  }
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
      accountingCurrency: input.accountingCurrency,
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
      items: [
        {
          orderItemId: TRENDYOL_SCENARIO_ITEM_ID,
          orderCommissionRatePct: input.commissionRatePctOverride,
          tariffBands: product.tariffBands,
          syncedCommissionRatePct: product.syncedCommissionRatePct,
          categoryId: product.categoryId,
          brandId: product.brandId,
        },
      ],
    },
    reference: input.reference,
    costs: [{ orderItemId: TRENDYOL_SCENARIO_ITEM_ID, profiles: input.costs }],
    fxQuotes: input.fxQuotes,
    acceptedReturns: [],
  };
}

/**
 * Evaluates one scenario: estimate the parcel, then tie its lines into a profit
 * statement under the store's settings, exactly as a real estimated order does.
 */
export function evaluateTrendyolScenario(input: TrendyolScenarioInput): TrendyolScenarioResult {
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
    evaluate: (unitPrice) => evaluateTrendyolScenario({ ...base, unitPrice }).statement,
    breakpoints: trendyolScenarioBreakpoints(base),
    target,
    minUnitPrice: params.minUnitPrice ?? DEFAULT_SCENARIO_MIN_UNIT_PRICE,
    maxUnitPrice: params.maxUnitPrice ?? null,
  });
}
