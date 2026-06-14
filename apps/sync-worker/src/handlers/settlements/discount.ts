// Discount settlement row → OrderItem refund-commission + seller-discount
// reconciliation handler.
//
// Same lookup pattern as handleSale (barcode + shipmentPackageId → OrderItem)
// but writes the refund-side columns:
//   - refundedCommissionAmountNet = Discount.commissionAmount / 1.20
//   - refundedCommissionVatAmount = Discount.commissionAmount − net
//   - sellerDiscountNet           = Discount.debt / (1 + unitVatRate/100)
//   - sellerDiscountVatAmount     = Discount.debt − sellerDiscountNet
//
// Research §3.2: Discount row mirrors Sale schema with debt/credit swap.
// commissionAmount on a Discount row = REFUNDED commission for that line.
// debt on a Discount row = lineSellerDiscount (KDV-dahil), where the VAT
// rate is the line's unitVatRate (Trendyol stores it on each OrderItem
// from the order arrival mapping).
//
// CHECK constraint (PR-3 migration.sql):
//   refunded_commission_amount_net <= gross_commission_amount_net
// Handler does not guard against this — the DB rejects on violation.
// Caller logs + skips if Prisma surfaces a P-code error.

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import { commissionVatDivisor, type TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { resolveFeeDefinition } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

import type { HandleSettlementResult } from './sale';

export async function handleDiscount(
  storeId: string,
  row: TrendyolFinancialTransaction,
  tx: Prisma.TransactionClient,
): Promise<HandleSettlementResult> {
  if (row.shipmentPackageId === null || row.barcode === null || row.commissionAmount === null) {
    syncLog.warn('settlements.discount.sparse', {
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
    select: { id: true, orderDate: true },
  });
  if (order === null) {
    syncLog.warn('settlements.discount.order-not-found', { id: row.id, platformOrderId });
    return { applied: false, skipReason: 'order_not_found' };
  }

  const variant = await tx.productVariant.findFirst({
    where: { storeId, barcode: row.barcode },
    select: { id: true },
  });
  if (variant === null) {
    syncLog.warn('settlements.discount.variant-not-found', { id: row.id, barcode: row.barcode });
    return { applied: false, skipReason: 'variant_not_found' };
  }

  const item = await tx.orderItem.findFirst({
    where: { orderId: order.id, productVariantId: variant.id },
    select: { id: true, unitVatRate: true },
  });
  if (item === null) {
    syncLog.warn('settlements.discount.item-not-found', {
      id: row.id,
      orderId: order.id,
      variantId: variant.id,
    });
    return { applied: false, skipReason: 'item_not_found' };
  }

  // Refunded commission split — same DB-driven rate as Sale (denetim A);
  // komisyon KDV oranı fee_definitions ALL/COMMISSION_INVOICE'tan order.orderDate'e göre.
  const commissionVatDef = await resolveFeeDefinition(tx, {
    platform: 'TRENDYOL',
    feeType: 'COMMISSION_INVOICE',
    at: order.orderDate,
  });
  const refundedGross = new Decimal(row.commissionAmount);
  const refundedCommissionAmountNet = refundedGross
    .div(commissionVatDivisor(commissionVatDef.defaultVatRate.toString()))
    .toDecimalPlaces(2);
  const refundedCommissionVatAmount = refundedGross.sub(refundedCommissionAmountNet);

  // Seller discount split — uses the line's own unitVatRate (varies per
  // line; commission VAT is fixed but discount VAT mirrors the product).
  // unitVatRate may be null on legacy items; fallback skips the split.
  let sellerDiscountNet: Decimal | undefined;
  let sellerDiscountVatAmount: Decimal | undefined;
  if (item.unitVatRate !== null) {
    const debtGross = new Decimal(row.debt);
    const unitVatRate = new Decimal(item.unitVatRate);
    const divisor = unitVatRate.div(100).add(1);
    sellerDiscountNet = debtGross.div(divisor).toDecimalPlaces(2);
    sellerDiscountVatAmount = debtGross.sub(sellerDiscountNet);
  } else {
    syncLog.warn('settlements.discount.unit-vat-rate-null', { id: row.id, itemId: item.id });
  }

  await tx.orderItem.update({
    where: { id: item.id },
    data: {
      refundedCommissionAmountNet,
      refundedCommissionVatAmount,
      ...(sellerDiscountNet !== undefined && sellerDiscountVatAmount !== undefined
        ? { sellerDiscountNet, sellerDiscountVatAmount }
        : {}),
    },
  });

  return { applied: true };
}
