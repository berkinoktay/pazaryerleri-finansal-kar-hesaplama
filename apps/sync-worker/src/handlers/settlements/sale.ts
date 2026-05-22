// Sale settlement row → OrderItem reconciliation handler.
//
// Trendyol's /settlements endpoint emits one Sale row per OrderItem
// (research §3.1 — barcode + shipmentPackageId pair uniquely identifies
// the line). This handler:
//   1. Looks up the local Order via (storeId, platformOrderId =
//      shipmentPackageId.toString()).
//   2. Looks up the OrderItem via (orderId, productVariant.barcode).
//   3. Writes Trendyol-authoritative commission values:
//        - grossCommissionAmountNet = commissionAmount / 1.20
//        - grossCommissionVatAmount = commissionAmount − net
//        - commissionInvoiceSerialNumber = raw DCFxxx string
//
// COMMISSION_VAT_RATE = 20% per design §12.2 #1 (sabit varsayım, V1).
//
// Order Sync (PR-A) already wrote grossCommissionAmountNet/VatAmount in
// the mapper using `lineGrossAmount × commissionRate / 100 / 1.20`. The
// settlement value is mathematically identical when the commission rate
// hasn't changed between order arrival and settlement, but Trendyol's
// invoice is the canonical source — we overwrite either way to absorb
// any commission-rate change Trendyol applied in the interim.
//
// PR-9 write-once triggers (estimated_net_profit + unit_cost_snapshot_*)
// are NOT touched here — handler writes only to OrderItem fields that
// settlements is the authority for (commission + sellerDiscount + raw
// invoice serial). The commissionInvoiceId FK stays NULL — PR-7 commit 6
// (CommissionInvoice synthesis) backfills it from this serial.
//
// Sparse field tolerance (research §3.1 + BUG #2 lesson):
//   - shipmentPackageId may be null on a malformed row → skip + log
//   - barcode may be null when the line is unmapped → skip + log
//   - commissionAmount may be null on a refund-cancel chain → skip + log
//   - Order/variant/OrderItem lookup miss → skip + log (not an error;
//     out-of-window or pre-launch backfill data)

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

/** Trendyol commission VAT is 20% by convention (design §12.2 #1). */
const COMMISSION_VAT_DIVISOR = new Decimal('1.20');

export interface HandleSettlementResult {
  /** True if the row was applied to the DB; false if skipped (logged). */
  applied: boolean;
  /** Skip reason — useful for tests + worker telemetry. Empty when applied. */
  skipReason?:
    | 'sparse_field'
    | 'order_not_found'
    | 'variant_not_found'
    | 'item_not_found'
    | 'no_orders_in_cycle';
}

/**
 * Apply a settlement Sale row to its matching OrderItem.
 *
 * Idempotent: re-running on the same row writes the same values (Trendyol's
 * authoritative numbers don't drift). PR-9 write-once triggers do not gate
 * these columns — they're settlement-authoritative.
 */
export async function handleSale(
  storeId: string,
  row: TrendyolFinancialTransaction,
  tx: Prisma.TransactionClient,
): Promise<HandleSettlementResult> {
  // BUG #8 diagnostic — entry log before any skip path. Removed once the
  // silent-failure root cause is identified. Pairs with `settlements.sale.applied`
  // at the success return; the cardinality gap (entries vs applied vs warn)
  // pinpoints which branch the rows take in prod.
  syncLog.info('settlements.sale.entry', {
    id: row.id,
    shipmentPackageId: row.shipmentPackageId,
    barcode: row.barcode,
    commissionAmount: row.commissionAmount,
    paymentOrderId: row.paymentOrderId,
    commissionInvoiceSerialNumber: row.commissionInvoiceSerialNumber,
  });

  if (row.shipmentPackageId === null || row.barcode === null || row.commissionAmount === null) {
    syncLog.warn('settlements.sale.sparse', {
      id: row.id,
      shipmentPackageId: row.shipmentPackageId,
      barcode: row.barcode,
      commissionAmount: row.commissionAmount,
    });
    return { applied: false, skipReason: 'sparse_field' };
  }

  const platformOrderId = row.shipmentPackageId.toString();
  const order = await tx.order.findFirst({
    where: { storeId, platformOrderId },
    select: { id: true },
  });
  if (order === null) {
    syncLog.warn('settlements.sale.order-not-found', { id: row.id, platformOrderId });
    return { applied: false, skipReason: 'order_not_found' };
  }

  const variant = await tx.productVariant.findFirst({
    where: { storeId, barcode: row.barcode },
    select: { id: true },
  });
  if (variant === null) {
    syncLog.warn('settlements.sale.variant-not-found', { id: row.id, barcode: row.barcode });
    return { applied: false, skipReason: 'variant_not_found' };
  }

  const item = await tx.orderItem.findFirst({
    where: { orderId: order.id, productVariantId: variant.id },
    select: { id: true },
  });
  if (item === null) {
    syncLog.warn('settlements.sale.item-not-found', {
      id: row.id,
      orderId: order.id,
      variantId: variant.id,
    });
    return { applied: false, skipReason: 'item_not_found' };
  }

  // Commission KDV split — Trendyol's commissionAmount is GROSS (KDV-dahil),
  // design §5.2 line 1083.
  const commissionGross = new Decimal(row.commissionAmount);
  const grossCommissionAmountNet = commissionGross.div(COMMISSION_VAT_DIVISOR).toDecimalPlaces(2);
  const grossCommissionVatAmount = commissionGross.sub(grossCommissionAmountNet);

  await tx.orderItem.update({
    where: { id: item.id },
    data: {
      grossCommissionAmountNet,
      grossCommissionVatAmount,
      // commissionInvoiceSerialNumber may be null on stage / older rows;
      // only write when present so we don't blank a previously-set value.
      ...(row.commissionInvoiceSerialNumber !== null
        ? { commissionInvoiceSerialNumber: row.commissionInvoiceSerialNumber }
        : {}),
    },
  });

  // PR-7 commit 5 cascade prerequisite: backfill Order.paymentOrderId /
  // paymentDate from the settlement Sale row. Trendyol stamps these on
  // the Sale row once a PaymentOrder cycle materialises (research §3.1:
  // T+18..30 after order arrival). handlePaymentOrderEntry then locates
  // the cycle's orders via this column.
  //
  // Idempotent: updateMany with `paymentOrderId: null` filter — only the
  // first non-null Sale row writes the column. Re-poll cron (PR-12) safe.
  let paymentOrderIdBackfilled = false;
  if (row.paymentOrderId !== null && row.paymentDate !== null) {
    const result = await tx.order.updateMany({
      where: { id: order.id, paymentOrderId: null },
      data: {
        paymentOrderId: BigInt(row.paymentOrderId),
        paymentDate: new Date(row.paymentDate),
      },
    });
    paymentOrderIdBackfilled = result.count > 0;
  }

  // BUG #8 diagnostic — success path log. Removed alongside the entry log
  // once the silent-failure root cause is identified.
  syncLog.info('settlements.sale.applied', {
    id: row.id,
    orderId: order.id,
    itemId: item.id,
    grossCommissionAmountNet: grossCommissionAmountNet.toString(),
    commissionInvoiceSerialBackfilled: row.commissionInvoiceSerialNumber !== null,
    paymentOrderIdBackfilled,
  });

  return { applied: true };
}
