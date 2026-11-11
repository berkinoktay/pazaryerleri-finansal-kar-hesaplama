/**
 * Variant-level shipping cost estimator (products-list display).
 *
 * Prepares the variant's inputs - desi = `dimensionalWeightOverride ?? syncedDimensionalWeight`
 * (synced is non-null, >= 0), Barem range = `variant.salePrice`, fast-eligibility via
 * `hasFastDeliverySetup` - and delegates the Barem-vs-desi tariff resolution to
 * `resolveTariffForDesi` (in `@pazarsync/profit`). This variant estimator is that
 * resolver's only caller; the profit engine's pure counterpart is `resolveTrendyolShippingNet`.
 *
 * Outcomes: STORE_NOT_FOUND / NO_CARRIER / OWN_CONTRACT_EMPTY / DESI_OVERFLOW, or a
 * `ShippingEstimate` (NORMAL / BAREM / OWN_CONTRACT). All money via `decimal.js`;
 * carrier thresholds live on `ShippingCarrier` rows (SQL-tunable). Called from the
 * products-list endpoint via a Prisma transaction client.
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

// --- Types + tariff resolver (source: @pazarsync/profit) ---------------------
// The Barem-vs-desi resolver `resolveTariffForDesi` and the ShippingEstimate /
// EstimateOutcome types live in @pazarsync/profit; this variant estimator is the
// resolver's only caller (the engine's pure counterpart is resolveTrendyolShippingNet).
// The types are re-exported here so the existing apps/api consumers (products-list,
// the SQL CTE, the validator) keep their import paths.
import { isTrendyolBaremEligible, resolveTariffForDesi } from '@pazarsync/profit';
import type {
  EstimateOutcome,
  EstimateUnavailableReason,
  ShippingEstimate,
} from '@pazarsync/profit';

export type { EstimateOutcome, EstimateUnavailableReason, ShippingEstimate };

// --- Helper -------------------------------------------------------------------

/**
 * A variant has "fast delivery setup" (and is therefore eligible for the
 * Barem destek tier on a Barem-supporting carrier) when its `deliveryDuration`
 * is set and within the carrier's `maxBaremEligibleDeliveryDuration` window
 * (Trendyol: 0 = ships today, 1 = ships by tomorrow). `deliveryDuration` is the
 * only signal: Trendyol retired the rush-delivery flag and the fast-delivery
 * option list in August 2026. The Barem predicate in `SHIPPING_ESTIMATE_CTE_SQL`
 * mirrors this rule (pinned by the equivalence test).
 *
 * Pure function - no I/O. Exported for direct unit testing. Delegates to the
 * single Barem rule `isTrendyolBaremEligible` in `@pazarsync/profit` so the
 * variant estimator and the scenario loader never drift; the carrier is always
 * present here, so the shared rule's null-window branch is unreachable from this
 * call site and the semantics are unchanged.
 */
export function hasFastDeliverySetup(
  variant: { deliveryDuration: number | null },
  carrier: { maxBaremEligibleDeliveryDuration: number },
): boolean {
  return isTrendyolBaremEligible({
    deliveryDurationDays: variant.deliveryDuration,
    carrierMaxBaremDurationDays: carrier.maxBaremEligibleDeliveryDuration,
  });
}

// --- Service ------------------------------------------------------------------

export async function estimateShippingCostForVariant(
  variantId: string,
  tx: Prisma.TransactionClient,
): Promise<EstimateOutcome> {
  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    include: { store: { include: { defaultShippingCarrier: true } } },
  });
  if (!variant?.store) return { ok: false, reason: 'STORE_NOT_FOUND' };

  // Desi: the synced column is non-null (>= 0), so there is always a value; the
  // user override wins when set.
  const desi = new Decimal(
    (variant.dimensionalWeightOverride ?? variant.syncedDimensionalWeight).toString(),
  );
  const carrier = variant.store.defaultShippingCarrier;

  // Barem-vs-desi resolution lives in @pazarsync/profit (resolveTariffForDesi; this
  // estimator is its only caller). grossTotalForBarem = the variant salePrice
  // (products-list display estimate).
  return resolveTariffForDesi(tx, {
    storeId: variant.store.id,
    tariffSource: variant.store.shippingTariffSource,
    carrier:
      carrier !== null
        ? {
            id: carrier.id,
            code: carrier.code,
            supportsBaremDestek: carrier.supportsBaremDestek,
            maxBaremDesi: new Decimal(carrier.maxBaremDesi.toString()),
          }
        : null,
    desi,
    grossTotalForBarem: new Decimal(variant.salePrice.toString()),
    fastEligible: carrier !== null && hasFastDeliverySetup(variant, carrier),
  });
}
