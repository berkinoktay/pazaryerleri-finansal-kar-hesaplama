/**
 * recomputeSettledProfit — settlement-side counterpart of
 * applyEstimateOnOrderCreate. Called by handlePaymentOrderEntry
 * (PR-7 commit 5) once the PaymentOrder cycle marks an Order's
 * ESTIMATE OrderFees as confirmed.
 *
 * INVARIANT (2026-06-14 karar — Hakediş Kontrolü temeli): settledNetProfit =
 * satıcının HAK ETTİĞİ kâr. Satış tabanı = Order.saleSubtotalNet (effectiveSale,
 * hak edilen) — Trendyol'un GERÇEKTE kredilediği OrderItem.settledSaleAmount
 * DEĞİL. Underpaid bir actual-payout'a ASLA sessizce çekilmez. Beklenen (bu
 * fonksiyon) vs gerçek-yatan farkı = gelecek "Hakediş Kontrolü" epiği (itiraz/
 * telafi). Bir gün "settled'ı gerçeğe çekeyim" deme — bu kasıtlı.
 *
 * Reads:
 *   - Order.saleSubtotalNet + saleVatTotal  (effectiveSale aggregate = HAK EDİLEN, immutable since arrival)
 *   - OrderItem rows (cost snapshot + commission split + seller discount)
 *   - OrderFee rows where source ∈ {SETTLEMENT, CARGO_INVOICE}
 *     OR  source = ESTIMATE AND confirmedAt IS NOT NULL
 *
 * Writes:
 *   - Order.settledNetProfit  (mutable column; PR-9 trigger guards only
 *     Order.estimated_net_profit — settledNetProfit is free-form).
 *
 * Idempotent — pure function of (Order + items + confirmed fees) state.
 * Re-running yields the same value unless new SETTLEMENT/CARGO_INVOICE
 * rows landed or ESTIMATE rows got confirmed since the last call.
 *
 * NULL on incomplete data:
 *   - Any OrderItem with unitCostSnapshotNet = NULL → settle skipped,
 *     settledNetProfit stays at whatever it was (previous null or partial value).
 *   - saleSubtotalNet / saleVatTotal NULL (no items inserted yet) → skipped.
 *
 * PR-9 invariant — estimatedNetProfit is NEVER touched here. The schema
 * write-once trigger would reject any UPDATE that distinct-from'd it;
 * this function writes only `settledNetProfit`.
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

import { computeProfit } from './profit-formula';

export interface RecomputeSettledProfitResult {
  /** True when settledNetProfit was written. False when skipped (logged in caller). */
  recomputed: boolean;
  skipReason?:
    | 'missing_sale_aggregate'
    | 'incomplete_cost_snapshots'
    | 'order_not_found'
    | 'profit_excluded';
  settledNetProfit?: Decimal;
}

export async function recomputeSettledProfit(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<RecomputeSettledProfitResult> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { saleSubtotalNet: true, saleVatTotal: true, profitExcludedAt: true },
  });
  if (order === null) return { recomputed: false, skipReason: 'order_not_found' };

  // Karar K1 (spec 2026-06-12): kâr-dışı sipariş settled kâr da almaz —
  // settlement fee SATIRLARI işlenmeye devam eder (finansal gerçek), yalnız
  // order-level settled kâr yazımı atlanır.
  if (order.profitExcludedAt !== null) {
    return { recomputed: false, skipReason: 'profit_excluded' };
  }

  if (order.saleSubtotalNet === null || order.saleVatTotal === null) {
    return { recomputed: false, skipReason: 'missing_sale_aggregate' };
  }

  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      quantity: true,
      unitCostSnapshotNet: true,
      unitCostSnapshotVatAmount: true,
      grossCommissionAmountNet: true,
      grossCommissionVatAmount: true,
      refundedCommissionAmountNet: true,
      refundedCommissionVatAmount: true,
      sellerDiscountNet: true,
      sellerDiscountVatAmount: true,
    },
  });

  // If any item lacks a cost snapshot, profit can't be computed accurately.
  // Settle is skipped — UI shows "kar hesaplanmadı" until snapshots fill in.
  const missingCost = items.some(
    (i) => i.unitCostSnapshotNet === null || i.unitCostSnapshotVatAmount === null,
  );
  if (missingCost) return { recomputed: false, skipReason: 'incomplete_cost_snapshots' };

  // Confirmed fees only: SETTLEMENT + CARGO_INVOICE rows, plus ESTIMATE
  // rows that PaymentOrder cycle marked confirmed.
  const fees = await tx.orderFee.findMany({
    where: {
      orderId,
      OR: [
        { source: { in: ['SETTLEMENT', 'CARGO_INVOICE'] } },
        { source: 'ESTIMATE', confirmedAt: { not: null } },
      ],
    },
    select: { amountNet: true, vatAmount: true, direction: true },
  });

  const result = computeProfit({
    saleSubtotalNet: new Decimal(order.saleSubtotalNet),
    saleVatTotal: new Decimal(order.saleVatTotal),
    items: items.map((i) => ({
      quantity: i.quantity,
      unitCostSnapshotNet: new Decimal(i.unitCostSnapshotNet!),
      unitCostSnapshotVatAmount: new Decimal(i.unitCostSnapshotVatAmount!),
      grossCommissionAmountNet: new Decimal(i.grossCommissionAmountNet),
      grossCommissionVatAmount: new Decimal(i.grossCommissionVatAmount),
      refundedCommissionAmountNet: new Decimal(i.refundedCommissionAmountNet),
      refundedCommissionVatAmount: new Decimal(i.refundedCommissionVatAmount),
      sellerDiscountNet: new Decimal(i.sellerDiscountNet),
      sellerDiscountVatAmount: new Decimal(i.sellerDiscountVatAmount),
    })),
    fees: fees.map((f) => ({
      amountNet: new Decimal(f.amountNet),
      vatAmount: new Decimal(f.vatAmount),
      direction: f.direction,
    })),
  });

  const settledNetProfit = result.netProfit.toDecimalPlaces(2);
  const settledNetVat = result.netVat.toDecimalPlaces(2);
  await tx.order.update({
    where: { id: orderId },
    data: { settledNetProfit, settledNetVat },
  });

  return { recomputed: true, settledNetProfit };
}
