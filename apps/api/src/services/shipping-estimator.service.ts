/**
 * Variant-level shipping cost estimator (products-list display).
 *
 * Prepares the variant's inputs - desi = `dimensionalWeightOverride ?? syncedDimensionalWeight`
 * (any stored value counts, a seller desi is at least 1; both null = no desi),
 * Barem range = `variant.salePrice`, Barem table from
 * `hasFastDeliverySetup` (table 1 when it holds, table 2 otherwise, through
 * `resolveTrendyolCatalogBaremTier`) - and delegates the Barem-vs-desi tariff resolution to
 * `resolveTariffForDesi` (in `@pazarsync/profit`). This variant estimator is that
 * resolver's only caller; the profit engine's pure counterpart is `resolveTrendyolShippingNet`.
 *
 * Outcomes: STORE_NOT_FOUND / NO_CARRIER / NO_DESI / OWN_CONTRACT_EMPTY / DESI_OVERFLOW, or a
 * `ShippingEstimate` (NORMAL / BAREM / OWN_CONTRACT). All money via `decimal.js`;
 * the desi and Barem rows and the Barem thresholds come from the default carrier's
 * tariff version in force now (`loadShippingTariffVersion`); a carrier with no
 * version in force is DESI_OVERFLOW. Called from the products-list endpoint via a
 * Prisma transaction client.
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

// --- Types + tariff resolver (source: @pazarsync/profit) ---------------------
// The Barem-vs-desi resolver `resolveTariffForDesi` and the ShippingEstimate /
// EstimateOutcome types live in @pazarsync/profit; this variant estimator is the
// resolver's only caller (the engine's pure counterpart is resolveTrendyolShippingNet).
// The types are re-exported here so the existing apps/api consumers (products-list,
// the SQL CTE, the validator) keep their import paths.
import {
  isTrendyolBaremEligible,
  loadShippingTariffVersion,
  resolveTariffForDesi,
  resolveTrendyolCatalogBaremTier,
} from '@pazarsync/profit';
import type {
  EstimateOutcome,
  EstimateUnavailableReason,
  ShippingEstimate,
} from '@pazarsync/profit';

export type { EstimateOutcome, EstimateUnavailableReason, ShippingEstimate };

// --- Helper -------------------------------------------------------------------

/**
 * A variant has "fast delivery setup" (and is therefore priced at Barem table 1,
 * any other variant at table 2, on a Barem-supporting carrier) when its
 * `deliveryDuration` is set and within the `maxBaremEligibleDeliveryDuration` window
 * of the carrier's tariff version in force (Trendyol: 0 = ships today, 1 = ships by
 * tomorrow). With no version in force (`null`) the variant does not have it.
 * `deliveryDuration` is the only signal: Trendyol retired the rush-delivery flag and
 * the fast-delivery option list in August 2026. The Barem table CASE in
 * `SHIPPING_ESTIMATE_CTE_SQL` mirrors this rule (pinned by the equivalence test).
 *
 * Pure function - no I/O. Exported for direct unit testing. Delegates to the
 * single Barem rule `isTrendyolBaremEligible` in `@pazarsync/profit` so the
 * variant estimator and the scenario loader never drift; a missing version maps to
 * the shared rule's null window (not eligible).
 */
export function hasFastDeliverySetup(
  variant: { deliveryDuration: number | null },
  version: { maxBaremEligibleDeliveryDuration: number } | null,
): boolean {
  return isTrendyolBaremEligible({
    deliveryDurationDays: variant.deliveryDuration,
    carrierMaxBaremDurationDays: version === null ? null : version.maxBaremEligibleDeliveryDuration,
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

  // Desi: the user override wins when set, else the marketplace's synced value;
  // both null = no desi (NO_DESI from the resolver). Any stored value counts.
  const effectiveDesi = variant.dimensionalWeightOverride ?? variant.syncedDimensionalWeight;
  const desi = effectiveDesi === null ? null : new Decimal(effectiveDesi.toString());
  const carrier = variant.store.defaultShippingCarrier;
  // The display estimate prices with the tariff version in force now; the SQL
  // mirror reads the same version through its $3 instant.
  const version =
    carrier === null
      ? null
      : await loadShippingTariffVersion(tx, { carrierId: carrier.id, at: new Date() });

  // Barem-vs-desi resolution lives in @pazarsync/profit (resolveTariffForDesi; this
  // estimator is its only caller). grossTotalForBarem = the variant salePrice
  // (products-list display estimate).
  return resolveTariffForDesi(tx, {
    storeId: variant.store.id,
    tariffSource: variant.store.shippingTariffSource,
    carrier: carrier === null ? null : { code: carrier.code, version },
    desi,
    grossTotalForBarem: new Decimal(variant.salePrice.toString()),
    baremTier: resolveTrendyolCatalogBaremTier({
      baremEligible: hasFastDeliverySetup(variant, version),
    }),
  });
}
