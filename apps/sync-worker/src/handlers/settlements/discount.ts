// Discount settlement row → OrderItem refund-commission reconciliation handler.
//
// Same lookup pattern as handleSale (barcode + shipmentPackageId → OrderItem)
// but writes the refund-side column:
//   - refundedCommissionGross = Discount.commissionAmount × quantity
//
// GROSS CONVENTION (2026-06-16, Bölüm E Task 18):
// Net-split (commissionVatDivisor / resolveFeeDefinition) KALDIRILDI.
// KDV adapter downstream commissionVatRate kolonundan türetir.
//
// ⚠️ lineSellerDiscountGross EZILMEZ: intake mapper discountDetails'ten
// kuruş-kesin kurdu (48,01). Hakediş Discount per-unit × quantity ×
// birim sapması ekleyebilir (48,00). Bu yüzden bu handler sadece
// refundedCommissionGross yazar; lineSellerDiscountGross intake'ten otoriter.
//
// QUANTITY (handleSale ile aynı, EMPİRİK 2026-06-14): Trendyol qty=N için N adet
// PER-UNIT Discount satırı gönderir. × OrderItem.quantity ile line-toplamına
// çıkarılır; idempotent (özdeş satırlar aynı toplamı yazar).
// Detay: docs/plans/2026-06-14-settlement-qty-per-unit-findings.md.

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';
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
    select: { id: true, quantity: true },
  });
  if (item === null) {
    syncLog.warn('settlements.discount.item-not-found', {
      id: row.id,
      orderId: order.id,
      variantId: variant.id,
    });
    return { applied: false, skipReason: 'item_not_found' };
  }

  // GROSS CONVENTION: commissionAmount KDV-dahil (gross), per-unit.
  // × quantity ile line-toplamına çıkar (#338). Net-split kaldırıldı.
  // lineSellerDiscountGross EZILMEZ — intake mapper otoriter (#338 DİKKAT).
  const quantity = new Decimal(item.quantity);
  const refundedCommissionGross = new Decimal(row.commissionAmount).mul(quantity);

  await tx.orderItem.update({
    where: { id: item.id },
    data: {
      refundedCommissionGross,
    },
  });

  return { applied: true };
}
