import { type Decimal } from 'decimal.js';
import { type ShippingTariffSource } from '@pazarsync/db/enums';

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
  readonly orderCommissionRatePct: Decimal | null; // rate on the order line; null or 0 = not sent
  readonly tariffBands: readonly TrendyolCommissionBand[] | null; // product commission tariff covering the order date, in stored order; null = none
  readonly syncedCommissionRatePct: Decimal | null; // product API rate, not tariff-aware; null or 0 = unknown
  readonly categoryId: string | null;
  readonly brandId: string | null;
}

/** Trendyol-specific attributes of a parcel. */
export interface TrendyolParcelAttributes {
  readonly fastDelivery: boolean;
  readonly fastDeliveryType: string | null;
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
}

/** One inclusive basket-amount band of the barem shipping price. */
export interface TrendyolBaremBand {
  readonly minOrderAmount: Decimal;
  readonly maxOrderAmount: Decimal;
  readonly priceNet: Decimal;
}

/** Shipping tariff effective on the order date. */
export interface TrendyolShippingTariff {
  readonly source: ShippingTariffSource; // Prisma enum: TRENDYOL_CONTRACT | OWN_CONTRACT
  readonly carrier: TrendyolShippingCarrier | null;
  readonly desiTariffNet: ReadonlyMap<string, Decimal>; // key = ceil(desi) as an integer string
  readonly baremBands: readonly TrendyolBaremBand[];
  readonly ownTariffNet: ReadonlyMap<string, Decimal>;
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
