/**
 * Paylaşılan kargo tarife çözümleyici — variant-level (apps/api products list)
 * ve order-level (profit estimate) estimator'ların ORTAK çekirdeği.
 *
 * Verilen (carrier, desi, brüt-tutar, hızlı-teslim-uygunluğu, tariffSource) için
 * tek bir `ShippingEstimate` ya da uygunsuzluk nedeni döner. Barem-vs-desi karar
 * ağacı burada YAŞAR (tek doğruluk kaynağı); iki estimator yalnız girdileri
 * (variant.salePrice / desi  vs  order brüt toplamı / cargoDeci-veya-ortalama)
 * hazırlar.
 *
 * Saf-ish: yalnız tariff tablolarını `tx` üzerinden okur, yazmaz. decimal.js.
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

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

export interface ResolveTariffInput {
  storeId: string;
  tariffSource: 'TRENDYOL_CONTRACT' | 'OWN_CONTRACT';
  /** null → NO_CARRIER (TRENDYOL_CONTRACT dalında). */
  carrier: {
    id: string;
    code: string;
    supportsBaremDestek: boolean;
    maxBaremDesi: Decimal;
  } | null;
  /** Effective desi (≥ 0); lookup `ceil(desi)` ile yapılır. */
  desi: Decimal;
  /** Barem aralığı için brüt tutar = effectiveSale (liste − satıcı indirimi); Trendyol indirimi hariç. */
  grossTotalForBarem: Decimal;
  /** Barem destek uygunluğu (variant veya order seviyesi hızlı-teslim). */
  fastEligible: boolean;
}

/**
 * Barem-vs-desi tarife çözümü. OWN_CONTRACT → own tarifesi; aksi TRENDYOL_CONTRACT:
 * carrier yoksa NO_CARRIER; Barem-uygun (destek + desi ≤ maxBaremDesi + hızlı +
 * brüt tutar aralıkta) → Barem; aksi/aralık-dışı → desi-bazlı; desi kademesi
 * yoksa DESI_OVERFLOW.
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

  if (carrier.supportsBaremDestek && desi.lte(carrier.maxBaremDesi) && fastEligible) {
    const barem = await tx.shippingBaremTariff.findFirst({
      where: {
        carrierId: carrier.id,
        minOrderAmount: { lte: grossTotalForBarem.toString() },
        maxOrderAmount: { gte: grossTotalForBarem.toString() },
      },
    });
    if (barem !== null) {
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

  const desiRow = await tx.shippingDesiTariff.findFirst({
    where: { carrierId: carrier.id, desi: desiCeil },
  });
  if (desiRow === null) return { ok: false, reason: 'DESI_OVERFLOW' };
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
