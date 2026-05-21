// Return settlement row → OrderFee REFUND_DEDUCTION insert.
//
// Design §5.2 line 1088: Return.debt → OrderFee REFUND_DEDUCTION (DEBIT).
// Pair: CommissionNegative on the same receiptId (commit 3 does not handle
// the pair — dispatcher classifies CommissionNegative as a separate
// COMMISSION_ADJUSTMENT OrderFee, fired through the same OrderFee insert
// machinery as the rest of the rare types).
//
// Schema invariant: OrderFee.amountNet is NET (schema convention). The
// Trendyol Return.debt is KDV-dahil. KDV split uses the matching
// OrderItem's unitVatRate (per-line VAT, not fixed) — research §3.2
// proved Return is per-OrderItem just like Sale/Discount.
//
// Idempotency: handler checks `(orderId, source=SETTLEMENT, externalRef
// trendyolId = row.id)` BEFORE insert. Re-poll cron may surface the same
// Return row multiple times; the existence check skips duplicates without
// a UNIQUE constraint (one would need a generated column to index Json).
//
// feeDefinitionId is left NULL — schema makes it nullable (line 959) and
// settlement-sourced fees have no fee_definition entry (deterministic
// ESTIMATE rows do, settlement rows don't).

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

import type { HandleSettlementResult } from './sale';

export async function handleReturn(
  storeId: string,
  row: TrendyolFinancialTransaction,
  tx: Prisma.TransactionClient,
): Promise<HandleSettlementResult> {
  if (row.shipmentPackageId === null || row.barcode === null) {
    syncLog.warn('settlements.return.sparse', {
      id: row.id,
      shipmentPackageId: row.shipmentPackageId,
      barcode: row.barcode,
    });
    return { applied: false, skipReason: 'sparse_field' };
  }

  const platformOrderId = row.shipmentPackageId.toString();
  const order = await tx.order.findFirst({
    where: { storeId, platformOrderId },
    select: { id: true, organizationId: true },
  });
  if (order === null) {
    syncLog.warn('settlements.return.order-not-found', { id: row.id, platformOrderId });
    return { applied: false, skipReason: 'order_not_found' };
  }

  const variant = await tx.productVariant.findFirst({
    where: { storeId, barcode: row.barcode },
    select: { id: true },
  });
  if (variant === null) {
    syncLog.warn('settlements.return.variant-not-found', { id: row.id, barcode: row.barcode });
    return { applied: false, skipReason: 'variant_not_found' };
  }

  const item = await tx.orderItem.findFirst({
    where: { orderId: order.id, productVariantId: variant.id },
    select: { id: true, unitVatRate: true },
  });
  if (item === null) {
    syncLog.warn('settlements.return.item-not-found', {
      id: row.id,
      orderId: order.id,
      variantId: variant.id,
    });
    return { applied: false, skipReason: 'item_not_found' };
  }

  // Idempotency — Trendyol id is unique per transaction; same row twice
  // means a re-poll or webhook redelivery (rare for /settlements but
  // defensive). Json path filter avoids needing a UNIQUE index.
  const existing = await tx.orderFee.findFirst({
    where: {
      orderId: order.id,
      source: 'SETTLEMENT',
      feeType: 'REFUND_DEDUCTION',
      externalRef: { path: ['trendyolId'], equals: row.id },
    },
    select: { id: true },
  });
  if (existing !== null) return { applied: false, skipReason: undefined };

  // KDV split via item's unitVatRate. Null fallback writes the gross
  // amount as NET with vatRate=0 — reconciliation tolerates this
  // (1-line edge) and audit log surfaces the gap.
  const debtGross = new Decimal(row.debt);
  let amountNet: Decimal;
  let vatRate: Decimal;
  let vatAmount: Decimal;
  if (item.unitVatRate !== null) {
    vatRate = new Decimal(item.unitVatRate);
    const divisor = vatRate.div(100).add(1);
    amountNet = debtGross.div(divisor).toDecimalPlaces(2);
    vatAmount = debtGross.sub(amountNet);
  } else {
    syncLog.warn('settlements.return.unit-vat-rate-null', { id: row.id, itemId: item.id });
    amountNet = debtGross;
    vatRate = new Decimal(0);
    vatAmount = new Decimal(0);
  }

  await tx.orderFee.create({
    data: {
      orderId: order.id,
      organizationId: order.organizationId,
      feeType: 'REFUND_DEDUCTION',
      source: 'SETTLEMENT',
      direction: 'DEBIT',
      amountNet,
      vatRate,
      vatAmount,
      displayName: 'İade',
      externalRef: {
        trendyolId: row.id,
        sellerId: row.sellerId,
        ...(row.receiptId !== null ? { receiptId: row.receiptId } : {}),
        ...(row.paymentOrderId !== null ? { paymentOrderId: row.paymentOrderId } : {}),
      },
    },
  });

  return { applied: true };
}
