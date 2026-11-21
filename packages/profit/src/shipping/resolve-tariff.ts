/**
 * Barem-vs-desi shipping tariff resolver. Only the products list's variant
 * estimator (apps/api shipping-estimator.service) uses it; the profit engine's
 * pure counterpart is `resolveTrendyolShippingNet`.
 *
 * For a given (carrier tariff version, desi, gross amount, fast-delivery
 * eligibility, tariffSource) it returns one `ShippingEstimate` or an
 * unavailability reason.
 *
 * Read-only. The TRENDYOL_CONTRACT branch picks its desi and Barem rows from the
 * carrier's tariff version the caller loaded (`loadShippingTariffVersion`) and
 * never queries; only the OWN_CONTRACT branch reads the store's own tariff through
 * `tx`. Never writes. decimal.js.
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

import type { ShippingTariffVersionRows } from './tariff-version';

export interface ShippingEstimate {
  amount: Decimal;
  carrierCode: string;
  tariffApplied: 'NORMAL' | 'BAREM' | 'OWN_CONTRACT';
  sourceTariffId: string | null;
  baseDesiAtEstimate: Decimal;
}

// NO_DESI emekli: desi'nin sıfır-tabanı (@default(0)) olduğundan "desi yok" durumu
// üretilemez — desi-bazlı tek başarısızlık DESI_OVERFLOW. Ürünler listesinin
// `ShippingEstimateStatus.NO_DESI`'si AYRI (SQL CTE'den gelir, canlı) — ona dokunulmadı.
// The products page's "missing desi" (override null AND synced 0) is a listing
// and call-to-action concept, not an estimate outcome: the estimate still
// resolves such a variant at desi 0, so it must not bring NO_DESI back.
export type EstimateUnavailableReason =
  | 'STORE_NOT_FOUND'
  | 'NO_CARRIER'
  | 'DESI_OVERFLOW'
  | 'OWN_CONTRACT_EMPTY';

export type EstimateOutcome =
  | { ok: true; estimate: ShippingEstimate }
  | { ok: false; reason: EstimateUnavailableReason };

export interface ResolveTariffInput {
  storeId: string;
  tariffSource: 'TRENDYOL_CONTRACT' | 'OWN_CONTRACT';
  /**
   * The store's default carrier with its tariff version in force at the estimate
   * instant. On the TRENDYOL_CONTRACT branch a null carrier is NO_CARRIER and a
   * null version (no version in force) is DESI_OVERFLOW.
   */
  carrier: {
    readonly code: string;
    readonly version: ShippingTariffVersionRows | null;
  } | null;
  /** Effective desi (≥ 0); lookup `ceil(desi)` ile yapılır. */
  desi: Decimal;
  /** Barem aralığı için brüt tutar = effectiveSale (liste − satıcı indirimi); Trendyol indirimi hariç. */
  grossTotalForBarem: Decimal;
  /** Barem destek uygunluğu (variant veya order seviyesi hızlı-teslim). */
  fastEligible: boolean;
}

/**
 * Barem-vs-desi tariff resolution. OWN_CONTRACT reads the store's own tariff.
 * Otherwise (TRENDYOL_CONTRACT): no carrier is NO_CARRIER; no version in force is
 * DESI_OVERFLOW; Barem-eligible (the version supports Barem, desi <= its
 * maxBaremDesi, fast delivery, gross amount inside a band) is BAREM; otherwise, or
 * above every band, the desi-based row; no row for the desi is DESI_OVERFLOW.
 */
export async function resolveTariffForDesi(
  tx: Prisma.TransactionClient,
  input: ResolveTariffInput,
): Promise<EstimateOutcome> {
  const { storeId, tariffSource, carrier, desi, grossTotalForBarem, fastEligible } = input;
  const desiCeil = Math.ceil(desi.toNumber());

  if (tariffSource === 'OWN_CONTRACT') {
    const row = await tx.ownShippingTariff.findUnique({
      where: { storeId_desi: { storeId, desi: desiCeil } },
    });
    if (row === null) return { ok: false, reason: 'OWN_CONTRACT_EMPTY' };
    return {
      ok: true,
      estimate: {
        amount: new Decimal(row.priceNet.toString()),
        carrierCode: 'OWN',
        tariffApplied: 'OWN_CONTRACT',
        sourceTariffId: row.id,
        baseDesiAtEstimate: desi,
      },
    };
  }

  if (carrier === null) return { ok: false, reason: 'NO_CARRIER' };

  // No version in force at the estimate instant: there is no desi row to price
  // from, the same outcome as a desi the version does not cover.
  const { version } = carrier;
  if (version === null) return { ok: false, reason: 'DESI_OVERFLOW' };

  if (version.supportsBaremDestek && desi.lte(version.maxBaremDesi) && fastEligible) {
    const barem = version.baremRows.find(
      (row) =>
        grossTotalForBarem.gte(row.minOrderAmount.toString()) &&
        grossTotalForBarem.lte(row.maxOrderAmount.toString()),
    );
    if (barem !== undefined) {
      return {
        ok: true,
        estimate: {
          amount: new Decimal(barem.priceNet.toString()),
          carrierCode: carrier.code,
          tariffApplied: 'BAREM',
          sourceTariffId: barem.id,
          baseDesiAtEstimate: desi,
        },
      };
    }
    // Brüt tutar tüm Barem aralıklarının üstünde → desi-bazlıya düş.
  }

  const desiRow = version.desiRows.find((row) => row.desi === desiCeil);
  if (desiRow === undefined) return { ok: false, reason: 'DESI_OVERFLOW' };
  return {
    ok: true,
    estimate: {
      amount: new Decimal(desiRow.priceNet.toString()),
      carrierCode: carrier.code,
      tariffApplied: 'NORMAL',
      sourceTariffId: desiRow.id,
      baseDesiAtEstimate: desi,
    },
  };
}
