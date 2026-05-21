// PaymentOrder ("Ödeme") otherfinancials row → confirmation cascade
// (PR-7 commit 5). The first PR-7 commit that touches MULTIPLE Order rows
// from a single input row — every other handler is per-line.
//
// Cascade scope (per Order in the cycle):
//   1. Confirm ESTIMATE OrderFees (PSF + PLATFORM_SERVICE_FAST + STOPPAGE)
//      → set confirmedAt + confirmedBy. Idempotent via `confirmedAt: null`
//      filter (no PR-9-style trigger; updateMany skips already-confirmed rows).
//   2. recomputeSettledProfit(orderId) → writes Order.settledNetProfit
//      using @pazarsync/profit's computeProfit. Skips if cost snapshots
//      incomplete.
//   3. Order.reconciliationStatus = FULLY_SETTLED.
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

import type { Prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { recomputeSettledProfit } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

import type { HandleSettlementResult } from './sale';

const CONFIRMABLE_FEE_TYPES = ['PLATFORM_SERVICE', 'PLATFORM_SERVICE_FAST', 'STOPPAGE'] as const;

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
    select: { id: true },
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
    // 1. Confirm ESTIMATE PSF + STOPPAGE rows — idempotent via null filter.
    await tx.orderFee.updateMany({
      where: {
        orderId: order.id,
        source: 'ESTIMATE',
        feeType: { in: [...CONFIRMABLE_FEE_TYPES] },
        confirmedAt: null,
      },
      data: { confirmedAt, confirmedBy },
    });

    // 2. Recompute settledNetProfit from confirmed fees + cost snapshots.
    //    recomputeSettledProfit only writes when all cost snapshots
    //    present + saleSubtotalNet/saleVatTotal non-null — skip in
    //    incomplete state is safe (subsequent cron run picks it up).
    await recomputeSettledProfit(order.id, tx);

    // 3. Mark order FULLY_SETTLED. Mutable column — set regardless of
    //    whether settledNetProfit was written (status reflects cycle
    //    completion; profit value reflects calculation completeness).
    await tx.order.update({
      where: { id: order.id },
      data: { reconciliationStatus: 'FULLY_SETTLED' },
    });
  }

  return { applied: true, orderCount: orders.length };
}
