import { resolveTrendyolBaremTier, type TrendyolBaremTier } from './barem-tier';

/**
 * Barem (Trendyol fast-delivery shipping tier) eligibility, the single rule shared
 * by the variant-level shipping estimator in apps/api and the scenario input loader
 * here. A product carries the fast-delivery label (Barem table 1; on a single-tier
 * version, the only way into Barem) only when its delivery duration is known and
 * within the carrier's maximum Barem-eligible delivery duration (Trendyol: 0 = ships
 * today, 1 = ships by tomorrow). A null delivery duration (the marketplace sent none)
 * or a null carrier window (the store has no carrier) is never eligible. Pure, no I/O.
 */
export function isTrendyolBaremEligible(params: {
  readonly deliveryDurationDays: number | null;
  readonly carrierMaxBaremDurationDays: number | null;
}): boolean {
  const { deliveryDurationDays, carrierMaxBaremDurationDays } = params;
  if (deliveryDurationDays === null || carrierMaxBaremDurationDays === null) {
    return false;
  }
  return deliveryDurationDays <= carrierMaxBaremDurationDays;
}

/**
 * The Barem table a catalog estimate (the products list) looks a product up in. A
 * catalog product has no ship-by date and has not shipped, so the order rule
 * (`resolveTrendyolBaremTier`) reads it as shipped on time: a product that passes
 * `isTrendyolBaremEligible` is table 1, any other table 2. On a single-tier version
 * (no table 2 band) a table 2 lookup finds no band and the estimate falls back to the
 * desi tariff, the rule that version was priced under. Pure, no I/O.
 */
export function resolveTrendyolCatalogBaremTier(params: {
  readonly baremEligible: boolean;
}): TrendyolBaremTier {
  return resolveTrendyolBaremTier({
    fastDelivery: params.baremEligible,
    agreedDeliveryDate: null,
    actualShipDate: null,
  }).tier;
}
