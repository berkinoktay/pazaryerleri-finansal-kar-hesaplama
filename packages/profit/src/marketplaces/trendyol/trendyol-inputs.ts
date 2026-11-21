import { type Decimal } from 'decimal.js';
import { type ShippingTariffSource } from '@pazarsync/db/enums';

import { type TrendyolBaremTier } from './barem-tier';

/** The `fastDeliveryType` value that marks a same-day shipment. */
export const TRENDYOL_SAME_DAY_SHIPPING_TYPE = 'SameDayShipping';

/** One band of a product commission tariff; both limits are inclusive. */
export interface TrendyolCommissionBand {
  readonly lowerLimit: Decimal | null; // inclusive; null = no lower limit
  readonly upperLimit: Decimal | null; // inclusive; null = no upper limit
  readonly ratePct: Decimal;
}

/** Commission inputs attached to one order item. */
export interface TrendyolItemAttributes {
  readonly orderItemId: string;
  // A scenario's explicit rate; applied verbatim ahead of the whole chain, zero
  // included (source OVERRIDE). null = no override. Orders never set this, so a stored
  // order resolves through the chain below exactly as before.
  readonly commissionRatePctOverride: Decimal | null;
  readonly orderCommissionRatePct: Decimal | null; // rate on the order line; null or 0 = not sent
  readonly syncedCommissionRatePct: Decimal | null; // product API rate, not tariff-aware; null or 0 = unknown
  readonly categoryId: string | null;
  readonly brandId: string | null;
  /**
   * The category rule rates of a captured order item, as they were at its capture
   * moment (order profit snapshot). When set, this item's category rung reads these
   * maps instead of the parcel-level ones: two items of the same category may have
   * been captured at different moments, so the rate is resolved per item.
   */
  readonly capturedCategoryRules?: TrendyolCommissionRules;
}

/** Trendyol-specific attributes of a parcel. */
export interface TrendyolParcelAttributes {
  readonly fastDelivery: boolean;
  readonly fastDeliveryType: string | null;
  // Trendyol's agreed ship-by instant (true UTC); null when Trendyol sent none.
  readonly agreedDeliveryDate: Date | null;
  readonly actualShipDate: Date | null;
  readonly usesSellerCargoAgreement: boolean;
  readonly items: readonly TrendyolItemAttributes[];
}

/** One inclusive band of the overseas (micro-export) return operation fee. */
export interface OverseasReturnTier {
  readonly minUnitSaleGross: Decimal;
  readonly maxUnitSaleGross: Decimal;
  readonly ratePct: Decimal;
}

/** Fee parameters effective on the order date. Every rate is a percentage. */
export interface TrendyolFeeParams {
  readonly psfStandardNet: Decimal;
  readonly psfSameDayNet: Decimal;
  readonly psfVatRatePct: Decimal;
  readonly stoppageRatePct: Decimal;
  readonly commissionVatRatePct: Decimal;
  readonly shippingVatRatePct: Decimal;
  readonly returnShippingVatRatePct: Decimal;
  readonly internationalServiceRatePct: Decimal; // applied to the VAT-inclusive sale; result is gross
  readonly internationalServiceVatRatePct: Decimal;
  readonly overseasReturnTiers: readonly OverseasReturnTier[];
}

/** A cargo carrier and its barem eligibility. */
export interface TrendyolShippingCarrier {
  readonly code: string;
  readonly supportsBarem: boolean;
  readonly maxBaremDesi: Decimal;
  // When true, the return shipment of an order that went out at Barem table 1 is priced
  // at table 1; otherwise at the desi tariff. Off on every version today.
  readonly baremAppliesToReturns: boolean;
}

/** One inclusive basket-amount band of the barem shipping price. */
export interface TrendyolBaremBand {
  readonly tier: TrendyolBaremTier;
  readonly minOrderAmount: Decimal;
  readonly maxOrderAmount: Decimal;
  readonly priceNet: Decimal;
}

/**
 * How an order's assigned carrier resolved, carried on the shipping tariff so the
 * shipping estimate can tell a not-recognized ORDER carrier apart from a non-order
 * context that simply has no carrier. `matched` means the order's `cargoProviderName`
 * resolved to an active carrier (its tariff is in `TrendyolShippingTariff.carrier`);
 * `not-recognized` means the name was null, blank, unknown (e.g. Trendyol's alternative
 * delivery), ambiguous, or only an inactive namesake, and carries the provider name as
 * Trendyol wrote it (null when null or blank). On the tariff, `null` is the non-order context (a scenario or the
 * store default): the carrier field alone decides, so a carrier-less TRENDYOL_CONTRACT
 * tariff stays NO_CARRIER / unavailable.
 */
export type TrendyolOrderCarrierOutcome =
  | { readonly kind: 'matched' }
  | { readonly kind: 'not-recognized'; readonly providerName: string | null };

/** Shipping tariff effective on the order date. */
export interface TrendyolShippingTariff {
  readonly source: ShippingTariffSource; // Prisma enum: TRENDYOL_CONTRACT | OWN_CONTRACT
  readonly carrier: TrendyolShippingCarrier | null;
  readonly desiTariffNet: ReadonlyMap<string, Decimal>; // key = ceil(desi) as an integer string
  readonly baremBands: readonly TrendyolBaremBand[];
  readonly ownTariffNet: ReadonlyMap<string, Decimal>;
  // How the order's carrier resolved (null = non-order context: scenario / store default).
  readonly orderCarrierOutcome: TrendyolOrderCarrierOutcome | null;
}

/** Category and category+brand commission rules. */
export interface TrendyolCommissionRules {
  readonly categoryRatePct: ReadonlyMap<string, Decimal>; // categoryId -> rate
  readonly categoryBrandRatePct: ReadonlyMap<string, Decimal>; // trendyolCategoryBrandKey -> rate
}

/** The full Trendyol reference data set for one order date. */
export interface TrendyolReferenceData {
  readonly fees: TrendyolFeeParams;
  readonly shipping: TrendyolShippingTariff;
  readonly commission: TrendyolCommissionRules;
}

/**
 * The single formatter of the `categoryBrandRatePct` map key. Both the commission
 * resolver and the test fixture build the key through this function so the two
 * can never drift.
 */
export function trendyolCategoryBrandKey(categoryId: string, brandId: string): string {
  return `${categoryId}:${brandId}`;
}
