// FULLY_SETTLED finalization gate (2026-06-15).
//
// Bir sipariş FULLY_SETTLED'a ANCAK şu iki şart birlikte sağlanınca geçer:
//   1. Ödeme döngüsü onaylı (handleSale Order.paymentOrderId'yi backfill etmiş), VE
//   2. Çözülmemiş hiçbir ESTIMATE fee kalmamış.
//
// "Çözülmemiş ESTIMATE" = confirmedAt=null bir ESTIMATE fee'nin gerçek karşılığı
// gelmemiş. Tek SUPERSEDE edilebilir tahmin SHIPPING'tir (gerçek CARGO_INVOICE
// SHIPPING ile değişir). PSF/STOPPAGE deterministiktir → PaymentOrder cascade
// yerinde confirm eder; SATICI-KARGO siparişlerinde ESTIMATE SHIPPING de orada
// confirm edilir (kendi tarifesinden tahmin = gerçek maliyet). Dolayısıyla
// TRENDYOL-KARGO siparişleri gerçek kargo faturası gelene kadar PARTIALLY_SETTLED
// kalır — tasarım gereği TIMEOUT YOK (Berkin 2026-06-15: "dürüst takılı kalsın";
// böylece "Mutabakat tamamlandı" rozeti her sayının Trendyol-gerçeği olduğunu
// garanti eder, settled kâr asla eksik kargoyla "kesin" gösterilmez).

import type { Prisma } from '@pazarsync/db';
import { recomputeSettledProfit } from '@pazarsync/profit';

/**
 * True when an ESTIMATE fee still lacks its real/confirmed counterpart — i.e.
 * the order is NOT yet fully reconcilable. Post-PaymentOrder the only such fee
 * is a Trendyol-cargo SHIPPING estimate whose real CARGO_INVOICE hasn't landed.
 */
async function hasUnresolvedEstimateFee(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const unconfirmed = await tx.orderFee.findMany({
    where: { orderId, source: 'ESTIMATE', confirmedAt: null },
    select: { feeType: true },
  });
  for (const fee of unconfirmed) {
    if (fee.feeType === 'SHIPPING') {
      // SHIPPING tahmini yalnız gerçek bir CARGO_INVOICE SHIPPING ile çözülür.
      const realCargoCount = await tx.orderFee.count({
        where: { orderId, source: 'CARGO_INVOICE', feeType: 'SHIPPING' },
      });
      if (realCargoCount === 0) return true;
    } else {
      // PSF/STOPPAGE PaymentOrder'da confirm edilmeliydi; edilmemişse henüz hazır değil.
      return true;
    }
  }
  return false;
}

/**
 * Try to finalize an order's reconciliation: set FULLY_SETTLED + write
 * settledNetProfit ONLY when the payment cycle is confirmed AND every estimate
 * has its real value. Called from BOTH the PaymentOrder cascade and the cargo
 * invoice handler (cargo can arrive after payment). Idempotent: re-runs are
 * no-ops once FULLY_SETTLED, and a still-incomplete order is left untouched
 * (stays PARTIALLY_SETTLED, settledNetProfit unset — no premature "final" number).
 *
 * Returns true if the order is (now or already) FULLY_SETTLED.
 */
export async function tryFinalizeReconciliation(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { paymentOrderId: true, reconciliationStatus: true, profitExcludedAt: true },
  });
  if (order === null || order.paymentOrderId === null) return false;

  // A still-pending real value (e.g. Trendyol-cargo SHIPPING without its
  // CARGO_INVOICE) blocks finalization. Don't recompute — a partial settled
  // number must never be written. Already-FULLY stays FULLY (shouldn't reach
  // here in that state, but never downgrade).
  if (await hasUnresolvedEstimateFee(orderId, tx)) {
    return order.reconciliationStatus === 'FULLY_SETTLED';
  }

  // Every estimate now has its real value → recompute UNCONDITIONALLY so a late
  // CARGO_INVOICE / settlement fee that landed after a prior FULLY is reabsorbed
  // into settledNetProfit (idempotent: same inputs → same value).
  const { recomputed } = await recomputeSettledProfit(orderId, tx);

  // Finalize only when there is a real settled number — OR the order is
  // profit-excluded (settled is intentionally null by the cost-deadline freeze;
  // the payment cycle is still complete). An incomplete-cost order that is NOT
  // excluded stays PARTIALLY_SETTLED: no "Mutabakat tamamlandı" without a number.
  if (!recomputed && order.profitExcludedAt === null) {
    return order.reconciliationStatus === 'FULLY_SETTLED';
  }

  if (order.reconciliationStatus !== 'FULLY_SETTLED') {
    await tx.order.update({
      where: { id: orderId },
      data: { reconciliationStatus: 'FULLY_SETTLED' },
    });
  }
  return true;
}
