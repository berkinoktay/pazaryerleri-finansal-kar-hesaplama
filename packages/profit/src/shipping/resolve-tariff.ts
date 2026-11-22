/**
 * Barem-vs-desi shipping tariff resolver. Only the products list's variant
 * estimator (apps/api shipping-estimator.service) uses it; the profit engine's
 * pure counterpart is `resolveTrendyolShippingNet`.
 *
 * For a given (carrier tariff version, desi, gross amount, Barem table,
 * tariffSource) it returns one `ShippingEstimate` or an unavailability reason.
 *
 * Read-only. The TRENDYOL_CONTRACT branch picks its desi and Barem rows from the
 * carrier's tariff version the caller loaded (`loadShippingTariffVersion`) and
 * never queries; only the OWN_CONTRACT branch reads the store's own tariff through
 * `tx`. Never writes. decimal.js.
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import type { BaremTier } from '@pazarsync/db/enums';

import type { ShippingTariffVersionRows } from './tariff-version';

export interface ShippingEstimate {
  amount: Decimal;
  carrierCode: string;
  tariffApplied: 'NORMAL' | 'BAREM' | 'OWN_CONTRACT';
  sourceTariffId: string | null;
  baseDesiAtEstimate: Decimal;
}

// NO_DESI: the variant has no effective desi (no seller override and no desi
// from the marketplace), so there is no tariff row to price from. A desi of 0 is
// a real desi and is priced. The products list's SQL mirror
// (`SHIPPING_ESTIMATE_CTE_SQL`) emits the same status in the same precedence:
// NO_CARRIER (TRENDYOL_CONTRACT only) > NO_DESI > OWN_CONTRACT_EMPTY / DESI_OVERFLOW.
export type EstimateUnavailableReason =
  | 'STORE_NOT_FOUND'
  | 'NO_CARRIER'
  | 'NO_DESI'
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
  /**
   * Effective desi (>= 0, 0 is a real desi), looked up as `ceil(desi)`; null when
   * the variant has none (NO_DESI).
   */
  desi: Decimal | null;
  /** Barem aralığı için brüt tutar = effectiveSale (liste − satıcı indirimi); Trendyol indirimi hariç. */
  grossTotalForBarem: Decimal;
  /**
   * The Barem table to look the gross amount up in (`resolveTrendyolCatalogBaremTier`:
   * table 1 for a fast-delivery product, table 2 otherwise).
   */
  baremTier: BaremTier;
}

/**
 * The integer desi tier the tariff tables are keyed by: `ceil(desi)`. Desi is a
 * dimensional-weight quantity, not money (audited exemption in audit-money.config.ts).
 */
function desiTier(desi: Decimal): number {
  return Math.ceil(desi.toNumber());
}

/**
 * Barem-vs-desi tariff resolution. OWN_CONTRACT: no desi is NO_DESI, otherwise the
 * store's own tariff. Otherwise (TRENDYOL_CONTRACT): no carrier is NO_CARRIER; no
 * desi is NO_DESI; no version in force is DESI_OVERFLOW; inside the Barem limits
 * (the version supports Barem, desi <= its maxBaremDesi) a band of the `baremTier`
 * table holding the gross amount is BAREM; otherwise (no band of that table holds
 * it, e.g. a single-tier version has no table 2 band) the desi-based row; no row for
 * the desi is DESI_OVERFLOW.
 */
export async function resolveTariffForDesi(
  tx: Prisma.TransactionClient,
  input: ResolveTariffInput,
): Promise<EstimateOutcome> {
  const { storeId, tariffSource, carrier, desi, grossTotalForBarem, baremTier } = input;

  if (tariffSource === 'OWN_CONTRACT') {
    if (desi === null) return { ok: false, reason: 'NO_DESI' };
    const row = await tx.ownShippingTariff.findUnique({
      where: { storeId_desi: { storeId, desi: desiTier(desi) } },
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
  if (desi === null) return { ok: false, reason: 'NO_DESI' };

  // No version in force at the estimate instant: there is no desi row to price
  // from, the same outcome as a desi the version does not cover.
  const { version } = carrier;
  if (version === null) return { ok: false, reason: 'DESI_OVERFLOW' };

  if (version.supportsBaremDestek && desi.lte(version.maxBaremDesi)) {
    // The version's Barem rows come ordered by min_order_amount, so the lowest band of
    // the table holding the amount wins, as in the SQL mirror.
    const barem = version.baremRows.find(
      (row) =>
        row.tier === baremTier &&
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
    // No band of the table holds the amount: fall back to the desi row.
  }

  const desiCeil = desiTier(desi);
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
