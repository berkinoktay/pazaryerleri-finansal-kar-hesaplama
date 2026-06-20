/**
 * Order-level kargo tahmini (design 2026-06-13 §3).
 *
 * Desi:
 *   - `order.cargoDeci` doluysa (kargoya verildi, Trendyol ölçtü) onu kullan
 *   - aksi: ürün-ayarı desisinden **adet-ağırlıklı ortalama** = Σ(adet×desi)/Σ(adet)
 *     (`eff_desi = variant.dimensionalWeight ?? variant.syncedDimensionalWeight`, non-null ≥ 0)
 *
 * Barem aralığı: siparişin **effectiveSale brüt** toplamı = `order.saleGross` (GROSS,
 * KDV-dahil; = liste − satıcı indirimi = packageTotalPrice). Trendyol Barem kuralı ile
 * birebir: satıcı indirimi tabana DAHİL, Trendyol-finanslı indirim HARİÇ — bu tam olarak
 * effectiveSale'e denk gelir (müşterinin ödediği lineUnitPrice DEĞİL).
 *
 * Barem-uygunluk: `order.fastDelivery` (Trendyol paket bayrağı).
 *
 * Tarife çözümü `resolveTariffForDesi` (variant estimator ile ortak çekirdek).
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

import { resolveTariffForDesi, type EstimateOutcome } from './resolve-tariff';

export async function estimateShippingCostForOrder(
  orderId: string,
  tx: Prisma.TransactionClient,
  opts?: { applyBarem?: boolean },
): Promise<EstimateOutcome> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { productVariant: true } },
      store: { include: { defaultShippingCarrier: true } },
    },
  });
  if (order === null || order.store === null) {
    return { ok: false, reason: 'STORE_NOT_FOUND' };
  }

  // ─── Desi: cargoDeci (Trendyol ölçümü) > ürün-ayarı adet-ağırlıklı ortalama ──
  let desi: Decimal;
  if (order.cargoDeci !== null) {
    desi = new Decimal(order.cargoDeci.toString());
  } else {
    let weightedDesi = new Decimal(0);
    let qtyTotal = new Decimal(0);
    for (const item of order.items) {
      const variant = item.productVariant;
      // Çözülmemiş/SetNull'lanmış variant'ı ortalamaya KATMA — yoksa eksik bir
      // ürünü desi-0'a (en ucuz kademe) çöker, kargoyu olduğundan az gösterir.
      if (variant === null) continue;
      const effDesi = new Decimal(
        (variant.dimensionalWeight ?? variant.syncedDimensionalWeight).toString(),
      );
      const qty = new Decimal(item.quantity);
      weightedDesi = weightedDesi.add(effDesi.mul(qty));
      qtyTotal = qtyTotal.add(qty);
    }
    desi = qtyTotal.isZero() ? new Decimal(0) : weightedDesi.div(qtyTotal);
  }

  // ─── Barem aralığı: effectiveSale brüt sepet (liste − satıcı indirimi) ──────────
  // GROSS konvansiyon (2026-06-16): order.saleGross zaten brüt effectiveSale
  // (= packageTotalPrice; net+vat birleştirmeye gerek yok). Satış bilinmiyorsa
  // Barem'e GİRME (gross=0 en ucuz kademeyi yanlış eşleştirir) → desi-bazlıya düş.
  const hasSaleAggregates = order.saleGross !== null;
  const grossTotalForBarem =
    order.saleGross !== null ? new Decimal(order.saleGross.toString()) : new Decimal(0);

  const carrier = order.store.defaultShippingCarrier;
  return resolveTariffForDesi(tx, {
    storeId: order.store.id,
    tariffSource: order.store.shippingTariffSource,
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
    grossTotalForBarem,
    fastEligible:
      opts?.applyBarem === false ? false : order.fastDelivery === true && hasSaleAggregates,
  });
}
