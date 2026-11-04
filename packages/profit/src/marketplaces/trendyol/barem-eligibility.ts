/**
 * Barem (Trendyol fast-delivery shipping tier) eligibility, the single rule shared
 * by the variant-level shipping estimator in apps/api and the scenario input loader
 * here. A product qualifies for the Barem destek tier only when its delivery
 * duration is known and within the carrier's maximum Barem-eligible delivery
 * duration (Trendyol: 0 = ships today, 1 = ships by tomorrow). A null delivery
 * duration (the marketplace sent none) or a null carrier window (the store has no
 * carrier) is never eligible. Pure, no I/O.
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
