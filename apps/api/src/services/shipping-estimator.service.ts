/**
 * Shipping cost estimator service.
 *
 * Per spec §5.2 (docs/superpowers/specs/2026-05-17-shipping-cost-estimation-design.md):
 * resolves a `ShippingEstimate` from variant + store config + tariff data, or
 * one of the 5 documented unavailable reasons. Algorithm:
 *
 *   1. Fetch variant with store + defaultShippingCarrier.
 *   2. No store → STORE_NOT_FOUND.
 *   3. OWN_CONTRACT branch: look up own_shipping_tariffs by (storeId, ceil(desi)).
 *      V1 always empty → OWN_CONTRACT_EMPTY.
 *   4. TRENDYOL_CONTRACT branch:
 *      - no carrier → NO_CARRIER
 *      - no desi (neither dimensional nor synced) → NO_DESI
 *      - Barem path: carrier supports it AND desi within carrier.maxBaremDesi AND
 *        variant has fast-delivery setup → look up barem tier by salePrice range.
 *        Found → BAREM estimate. Not found (price ≥ all ranges) → fall through.
 *      - Normal path: look up shipping_desi_tariffs by (carrierId, ceil(desi)).
 *        Found → NORMAL estimate. Not found → DESI_OVERFLOW.
 *
 * All money handled via `decimal.js`. Carrier thresholds (Barem cap, eligibility
 * window) live on `ShippingCarrier` rows so SQL updates suffice for re-tuning.
 *
 * Called from the products list endpoint (V1) via Prisma transaction client.
 * Order-level estimator (`estimateShippingCostForOrder`) is a V2 placeholder.
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShippingEstimate {
  amount: Decimal;
  carrierCode: string;
  tariffApplied: 'NORMAL' | 'BAREM' | 'OWN_CONTRACT';
  sourceTariffId: string | null;
  baseDesiAtEstimate: Decimal;
}

export type EstimateUnavailableReason =
  | 'STORE_NOT_FOUND'
  | 'NO_CARRIER'
  | 'NO_DESI'
  | 'DESI_OVERFLOW'
  | 'OWN_CONTRACT_EMPTY';

export type EstimateOutcome =
  | { ok: true; estimate: ShippingEstimate }
  | { ok: false; reason: EstimateUnavailableReason };

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

  // OWN_CONTRACT branch — look up tenant-private tariff by ceil(desi)
  if (variant.store.shippingTariffSource === 'OWN_CONTRACT') {
    const desi = variant.dimensionalWeight ?? variant.syncedDimensionalWeight;
    if (!desi) return { ok: false, reason: 'NO_DESI' };

    const desiCeil = Math.ceil(desi.toNumber());
    const row = await tx.ownShippingTariff.findUnique({
      where: { storeId_desi: { storeId: variant.store.id, desi: desiCeil } },
    });
    if (!row) return { ok: false, reason: 'OWN_CONTRACT_EMPTY' };

    return {
      ok: true,
      estimate: {
        amount: new Decimal(row.priceNet.toString()),
        carrierCode: 'OWN',
        tariffApplied: 'OWN_CONTRACT',
        sourceTariffId: row.id,
        baseDesiAtEstimate: new Decimal(desi.toString()),
      },
    };
  }

  // TRENDYOL_CONTRACT branch
  const carrier = variant.store.defaultShippingCarrier;
  if (!carrier) return { ok: false, reason: 'NO_CARRIER' };

  const desi = variant.dimensionalWeight ?? variant.syncedDimensionalWeight;
  if (!desi) return { ok: false, reason: 'NO_DESI' };

  // Barem path — all thresholds DB-driven (no inline 350 / 10 magic numbers).
  // Falls through to the normal desi tariff when:
  //   - the variant's salePrice lies above every Barem range, OR
  //   - the variant is not Barem-eligible (no fast delivery setup), OR
  //   - the carrier is in the "supportsBaremDestek = false" set, OR
  //   - the variant's desi exceeds the carrier's Barem cap (`maxBaremDesi`)
  if (
    carrier.supportsBaremDestek &&
    desi.lte(carrier.maxBaremDesi) &&
    hasFastDeliverySetup(variant, carrier)
  ) {
    const barem = await tx.shippingBaremTariff.findFirst({
      where: {
        carrierId: carrier.id,
        minOrderAmount: { lte: variant.salePrice.toString() },
        maxOrderAmount: { gt: variant.salePrice.toString() },
      },
    });
    if (barem) {
      return {
        ok: true,
        estimate: {
          amount: new Decimal(barem.priceNet.toString()),
          carrierCode: carrier.code,
          tariffApplied: 'BAREM',
          sourceTariffId: barem.id,
          baseDesiAtEstimate: new Decimal(desi.toString()),
        },
      };
    }
    // salePrice outside any Barem range → fall through to normal desi tariff.
  }

  // Normal desi-bazlı tariff
  const desiCeil = Math.ceil(desi.toNumber());
  const desiRow = await tx.shippingDesiTariff.findFirst({
    where: { carrierId: carrier.id, desi: desiCeil },
  });
  if (!desiRow) return { ok: false, reason: 'DESI_OVERFLOW' };

  return {
    ok: true,
    estimate: {
      amount: new Decimal(desiRow.priceNet.toString()),
      carrierCode: carrier.code,
      tariffApplied: 'NORMAL',
      sourceTariffId: desiRow.id,
      baseDesiAtEstimate: new Decimal(desi.toString()),
    },
  };
}

/**
 * V2: Order-level estimator. Reads MAX(items[].variant.dimensionalWeight) for
 * package desi, uses order.totalAmount for Barem range. NOT implemented in V1 —
 * the orders feature lands with sync integration. Signature kept stable so V2
 * callers can wire it in without breaking V1.
 */
export async function estimateShippingCostForOrder(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<EstimateOutcome> {
  // Touch the params so the V2-stable signature does not fail no-unused-vars.
  void orderId;
  void tx;
  throw new Error('estimateShippingCostForOrder: implemented in V2 (orders integration)');
}
