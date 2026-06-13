/**
 * Variant-level shipping cost estimator (products-list display).
 *
 * Prepares the variant's inputs — desi = `dimensionalWeight ?? syncedDimensionalWeight`
 * (synced is non-null, ≥ 0), Barem range = `variant.salePrice`, fast-eligibility via
 * `hasFastDeliverySetup` — and delegates the Barem-vs-desi tariff resolution to the
 * shared `resolveTariffForDesi` (in `@pazarsync/profit`), the single source of truth
 * also used by the order-level estimator (`estimateShippingCostForOrder`).
 *
 * Outcomes: STORE_NOT_FOUND / NO_CARRIER / OWN_CONTRACT_EMPTY / DESI_OVERFLOW, or a
 * `ShippingEstimate` (NORMAL / BAREM / OWN_CONTRACT). All money via `decimal.js`;
 * carrier thresholds live on `ShippingCarrier` rows (SQL-tunable). Called from the
 * products-list endpoint via a Prisma transaction client.
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

// ─── Types + shared core (single source: @pazarsync/profit) ──────────────────
// Barem-vs-desi çözücü `resolveTariffForDesi` + ShippingEstimate/EstimateOutcome
// @pazarsync/profit'te yaşar (order-level estimator ile ORTAK çekirdek). Tipler
// buradan re-export edilir ki mevcut apps/api tüketicileri (products-list, sql
// CTE, validator) import yolu değiştirmeden çalışsın.
import { resolveTariffForDesi } from '@pazarsync/profit';
import type {
  EstimateOutcome,
  EstimateUnavailableReason,
  ShippingEstimate,
} from '@pazarsync/profit';

export type { EstimateOutcome, EstimateUnavailableReason, ShippingEstimate };

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * A variant has "fast delivery setup" (and is therefore eligible for the
 * Barem destek tier on a Barem-supporting carrier) when ANY of:
 *   1. Its `deliveryDuration` is set and within the carrier's eligibility
 *      window (e.g. ≤ 1 day for Trendyol's "Hızlı Teslimat").
 *   2. `isRushDelivery` is explicitly true.
 *   3. `fastDeliveryOptions` is a non-empty array (the variant opted into
 *      one of Trendyol's named fast-delivery options).
 *
 * Pure function — no I/O. Exported for direct unit testing.
 */
export function hasFastDeliverySetup(
  variant: {
    deliveryDuration: number | null;
    isRushDelivery: boolean;
    fastDeliveryOptions: unknown;
  },
  carrier: { maxBaremEligibleDeliveryDuration: number },
): boolean {
  if (
    variant.deliveryDuration !== null &&
    variant.deliveryDuration <= carrier.maxBaremEligibleDeliveryDuration
  ) {
    return true;
  }
  if (variant.isRushDelivery === true) return true;
  if (Array.isArray(variant.fastDeliveryOptions) && variant.fastDeliveryOptions.length > 0) {
    return true;
  }
  return false;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function estimateShippingCostForVariant(
  variantId: string,
  tx: Prisma.TransactionClient,
): Promise<EstimateOutcome> {
  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    include: { store: { include: { defaultShippingCarrier: true } } },
  });
  if (!variant?.store) return { ok: false, reason: 'STORE_NOT_FOUND' };

  // Desi: synced kolonu non-null (≥ 0) → her zaman değer; override öncelikli.
  const desi = new Decimal(
    (variant.dimensionalWeight ?? variant.syncedDimensionalWeight).toString(),
  );
  const carrier = variant.store.defaultShippingCarrier;

  // Barem-vs-desi çözümü ortak çekirdekte (resolveTariffForDesi, @pazarsync/profit).
  // grossTotalForBarem = variant salePrice (products-list gösterim tahmini).
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
