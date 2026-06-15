// PaymentOrder ("Ödeme") otherfinancials row → confirmation cascade
// (PR-7 commit 5). The first PR-7 commit that touches MULTIPLE Order rows
// from a single input row — every other handler is per-line.
//
// Cascade scope (per Order in the cycle):
//   1. Confirm deterministic ESTIMATE OrderFees → set confirmedAt + confirmedBy.
//      PSF + STOPPAGE always; ESTIMATE SHIPPING too for seller-cargo orders
//      (own-tariff estimate is the real cost — no Trendyol cargo invoice comes).
//      Idempotent via `confirmedAt: null` filter.
//   2. tryFinalizeReconciliation(orderId) → writes Order.settledNetProfit +
//      flips reconciliationStatus to FULLY_SETTLED, but ONLY when every estimate
//      has its real value. Trendyol-cargo orders without a real CARGO_INVOICE
//      SHIPPING stay PARTIALLY_SETTLED (settledNetProfit unset) until the cargo
//      invoice handler re-runs the finalize — no premature "final" with a
//      missing-cargo number (Berkin 2026-06-15; timeout-free by design).
//
// PR-9 invariant (HARD GUARANTEE):
//   - Order.estimatedNetProfit is NEVER written. The write-once trigger
//     would reject any value-distinct UPDATE. Cascade writes only
//     `settledNetProfit` + `reconciliationStatus`.
//   - OrderFee.confirmedAt is a settle-time annotation; source stays
//     ESTIMATE (origin audit). Schema yorumu line 974: "confirmedAt +
//     confirmedBy: PSF/Stopaj ESTIMATE → SETTLEMENT confirmation".
//
// Cycle lookup depends on handleSale having backfilled Order.paymentOrderId.
// If no orders found → log + skip (re-poll cron PR-12 will resurface
// orphan cycles).

import type { OrderFeeType, Prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

import { tryFinalizeReconciliation } from './finalize-reconciliation';
import type { HandleSettlementResult } from './sale';

// PSF artık tek refinable PLATFORM_SERVICE satırı (SameDayShipping 6.99/10.99 rate
// estimate'te belirlenir; feeType hep PLATFORM_SERVICE). PLATFORM_SERVICE_FAST feeType'ı
// hiçbir kod yazmaz → confirmation listesinden çıkarıldı (2026-06-14).
const CONFIRMABLE_FEE_TYPES: readonly OrderFeeType[] = ['PLATFORM_SERVICE', 'STOPPAGE'];

// Satıcı kendi kargo anlaşmasını kullanıyorsa (usesSellerCargoAgreement) Trendyol
// kargo faturası BEKLENMEZ → ESTIMATE SHIPPING zaten gerçek maliyettir (kendi
// tarifesi) ve burada confirm edilir. Trendyol-kargo siparişlerinde SHIPPING
// confirm EDİLMEZ — gerçek CARGO_INVOICE'u bekler (finalize-reconciliation gate).
const SELLER_CARGO_CONFIRMABLE: readonly OrderFeeType[] = [...CONFIRMABLE_FEE_TYPES, 'SHIPPING'];

export interface HandlePaymentOrderEntryResult extends HandleSettlementResult {
  /** Number of orders the cycle touched. Useful for cron telemetry. */
  orderCount?: number;
}

export async function handlePaymentOrderEntry(
  storeId: string,
  _organizationId: string,
  row: TrendyolFinancialTransaction,
  tx: Prisma.TransactionClient,
): Promise<HandlePaymentOrderEntryResult> {
  if (row.paymentOrderId === null) {
    syncLog.warn('settlements.payment-order.sparse', { id: row.id });
    return { applied: false, skipReason: 'sparse_field' };
  }

  const paymentOrderId = BigInt(row.paymentOrderId);

  // handleSale backfills Order.paymentOrderId for every Sale settlement
  // row in the cycle. If we run before Sale rows processed, no orders
  // match — skip and let the next run handle it.
  const orders = await tx.order.findMany({
    where: { storeId, paymentOrderId },
    select: { id: true, usesSellerCargoAgreement: true },
  });
  if (orders.length === 0) {
    syncLog.warn('settlements.payment-order.no-orders-in-cycle', {
      paymentOrderId: row.paymentOrderId,
    });
    return { applied: false, skipReason: 'no_orders_in_cycle' };
  }

  const confirmedAt = new Date();
  const confirmedBy = `PaymentOrder:${row.paymentOrderId.toString()}`;

  for (const order of orders) {
    // 1. Confirm deterministic ESTIMATE fees — idempotent via null filter.
    //    PSF + STOPPAGE always. ESTIMATE SHIPPING too for seller-cargo orders
    //    (own-tariff estimate IS the real cost — no Trendyol cargo invoice
    //    comes) — BUT only when no real CARGO_INVOICE SHIPPING already exists.
    //    If Trendyol actually billed cargo (rare; cargo handler warns), that
    //    real fee supersedes; confirming the estimate too would double-count
    //    shipping in settled profit (estimate-on-order-create.ts invariant).
    //    Trendyol-cargo orders never confirm SHIPPING here → it stays unresolved
    //    until the real CARGO_INVOICE lands (finalize gate below).
    let confirmable = CONFIRMABLE_FEE_TYPES;
    if (order.usesSellerCargoAgreement) {
      const realCargoCount = await tx.orderFee.count({
        where: { orderId: order.id, source: 'CARGO_INVOICE', feeType: 'SHIPPING' },
      });
      if (realCargoCount === 0) confirmable = SELLER_CARGO_CONFIRMABLE;
    }
    await tx.orderFee.updateMany({
      where: {
        orderId: order.id,
        source: 'ESTIMATE',
        feeType: { in: [...confirmable] },
        confirmedAt: null,
      },
      data: { confirmedAt, confirmedBy },
    });

    // 2. Try to finalize: writes settledNetProfit + flips to FULLY_SETTLED ONLY
    //    when every estimate has its real value (Trendyol-cargo waits for the
    //    real CARGO_INVOICE; the cargo handler re-runs this when it lands). An
    //    incomplete order stays PARTIALLY_SETTLED with settledNetProfit unset —
    //    no premature "Mutabakat tamamlandı" with a missing-cargo number.
    await tryFinalizeReconciliation(order.id, tx);
  }

  return { applied: true, orderCount: orders.length };
}
