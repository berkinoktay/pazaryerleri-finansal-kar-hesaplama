/**
 * Mikro ihracat "Yurt Dışı İade Operasyon Bedeli" (Trendyol 16.07.2024 duyurusu).
 *
 * Mikro ihracat iadesi domestic iadeden TAMAMEN farklıdır: satış hakedişi satıcıda
 * KALIR (reverse YOK), komisyon iade edilmez, ürün genelde geri gelmez (maliyet iadesi
 * yok). Bunun YERİNE tek bir DEBIT ücret kesilir:
 *
 *   bedel = Σ (kabul edilen hakediş) × kademe-oranı
 *   hakediş = kabul edilen satış (KDV-dahil) − komisyon
 *   oran = ürünün KDV-dahil (birim) satış fiyatına göre: ≤2000₺ → %35, >2000₺ → %30
 *
 * Oran/eşik data-driven (MicroExportReturnFeeTier; Trendyol değişirse SQL UPDATE).
 * OVERSEAS_RETURN_OPERATION düz bir DEBIT OrderFee'dir (iade-leg DEĞİL): fold-return-legs
 * çalıştırılmaz; computeProfit `fees[]` üzerinden netProfit'ten düşülür.
 */
import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

export interface OverseasReturnLeg {
  /** Kabul edilen satış (KDV-dahil): lineSaleGross × kabul-oranı. */
  acceptedSaleGross: Decimal;
  /** Kabul edilen EFFECTIVE komisyon: (commissionGross − refundedCommissionGross) × kabul-oranı
   *  — hakediş = satış − effective komisyon. GROSS kullanmak indirimli siparişte çift-düşmedir. */
  acceptedCommissionGross: Decimal;
  /** Kademe oranı (kesir: 0.35 = %35). */
  rate: Decimal;
}

/**
 * Saf hesap: Σ max(0, hakediş) × oran. Hakediş = acceptedSaleGross − acceptedCommissionGross.
 * Alt sınır 0 (komisyon > satış anomalisi negatif bedel üretmesin). DB/I/O yok — unit-testable.
 */
export function overseasReturnOperationGross(legs: ReadonlyArray<OverseasReturnLeg>): Decimal {
  return legs.reduce((acc, leg) => {
    const hakedis = Decimal.max(0, leg.acceptedSaleGross.sub(leg.acceptedCommissionGross));
    return acc.add(hakedis.mul(leg.rate));
  }, new Decimal(0));
}

export class MicroExportReturnTierNotFoundError extends Error {
  constructor(public readonly saleGross: string) {
    super(`No MicroExportReturnFeeTier matches saleGross=${saleGross}`);
    this.name = 'MicroExportReturnTierNotFoundError';
  }
}

/**
 * Ürünün KDV-dahil (birim) satış fiyatına göre kademe oranını çözer (data-driven).
 * min ≤ saleGross ≤ max ve effectiveFrom ≤ at; en güncel effectiveFrom kazanır.
 */
export async function resolveOverseasReturnRate(
  tx: Prisma.TransactionClient,
  unitSaleGross: Decimal,
  at: Date,
): Promise<Decimal> {
  const tier = await tx.microExportReturnFeeTier.findFirst({
    where: {
      minSaleGross: { lte: unitSaleGross.toString() },
      maxSaleGross: { gte: unitSaleGross.toString() },
      effectiveFrom: { lte: at },
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { rate: true },
  });
  if (tier === null) throw new MicroExportReturnTierNotFoundError(unitSaleGross.toString());
  return new Decimal(tier.rate);
}
