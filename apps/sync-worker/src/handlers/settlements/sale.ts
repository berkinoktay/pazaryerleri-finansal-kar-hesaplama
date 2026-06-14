// Sale settlement row → OrderItem reconciliation handler.
//
// QUANTITY (2026-06-14, prod read-only ile EMPİRİK doğrulandı): Trendyol qty=N
// bir satır için N adet AYRI PER-UNIT Sale satırı gönderir — her satırın
// `credit`/`commissionAmount`'ı BİRİM başınadır ve N satır ÖZDEŞTİR (credit =
// ürünün birim liste fiyatı, tüm adetlerde aynı). Σ(N satır) = line-toplamı =
// lineGrossAmount × quantity. Kanıt: sipariş 11313045474 qty3 → 3 satır × 285 =
// 855; 11310655788 qty5 → 5 satır × 152 = 760. Detay:
// docs/plans/2026-06-14-settlement-qty-per-unit-findings.md.
//
// → OrderItem alanları LINE-TOPLAMIDIR (profit-formula bunları ×qty YAPMADAN
// ekler; mapper estimate'i de #337'den beri line-toplamı). Bu yüzden settlement
// değerleri × `OrderItem.quantity` ile line-toplamına çıkarılır. Satırlar özdeş
// olduğundan ×quantity overwrite IDEMPOTENT (her Sale satırı aynı line-toplamını
// yazar) ve CHECK-güvenli (gross tam line-toplamı tek atomik set; transient
// `refunded > gross` ihlali doğmaz). Tüm N Sale satırı tek hakediş döngüsünde
// birlikte gelir (iadeler AYRI Return satırı) → kısmi-settlement sapması yok.
//
// Bu handler:
//   1. Yerel Order'ı (storeId, platformOrderId = shipmentPackageId.toString()) ile bulur.
//   2. OrderItem'ı (orderId, productVariant.barcode) ile bulur.
//   3. Trendyol-otoriter komisyon değerlerini yazar (× quantity, line-toplamı):
//        - grossCommissionAmountNet = commissionAmount × quantity / 1.20
//        - grossCommissionVatAmount = commissionAmount × quantity − net
//        - commissionInvoiceSerialNumber = raw DCFxxx string
//
// Commission VAT rate is DB-driven (denetim A) — resolved per order via
// resolveFeeDefinition(fee_definitions ALL/COMMISSION_INVOICE) at order.orderDate,
// then commissionVatDivisor(rate) splits the KDV-dahil amount.
//
// Order Sync (PR-A + #337) already wrote grossCommissionAmountNet/VatAmount in
// the mapper as a LINE TOTAL (`lineGrossAmount × quantity × commissionRate /
// 100 / 1.20`). The settlement value is mathematically identical when the
// commission rate hasn't changed between order arrival and settlement, but
// Trendyol's invoice is the canonical source — we overwrite either way to
// absorb any commission-rate change Trendyol applied in the interim.
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
import { commissionVatDivisor, type TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { resolveFeeDefinition } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

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
    select: { id: true, orderDate: true },
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
    select: { id: true, quantity: true },
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
  // design §5.2 line 1083. Komisyon KDV oranı DB'den (denetim A), order.orderDate'e
  // göre çözülür; seed eksikse loud throw (PSF/STOPPAGE ile aynı).
  // × quantity: row.commissionAmount BİRİM başınadır (header) → line-toplamına çıkar.
  const quantity = new Decimal(item.quantity);
  const commissionVatDef = await resolveFeeDefinition(tx, {
    platform: 'TRENDYOL',
    feeType: 'COMMISSION_INVOICE',
    at: order.orderDate,
  });
  const commissionGross = new Decimal(row.commissionAmount).mul(quantity);
  const grossCommissionAmountNet = commissionGross
    .div(commissionVatDivisor(commissionVatDef.defaultVatRate.toString()))
    .toDecimalPlaces(2);
  const grossCommissionVatAmount = commissionGross.sub(grossCommissionAmountNet);

  await tx.orderItem.update({
    where: { id: item.id },
    data: {
      grossCommissionAmountNet,
      grossCommissionVatAmount,
      // Hakediş Kontrolü TEMELİ (2026-06-14): Trendyol'un kredilediği GERÇEK satışı
      // (ham `credit`, KDV-dahil) çıpa olarak yakala. KÂRA GİRMEZ — settled kâr
      // HAK EDİLEN'den (effectiveSale) hesaplanır; bu yalnız gelecek beklenen-vs-
      // gerçek mutabakatı için. `credit` de BİRİM → × quantity ile line-toplamı.
      // Defansif `!= null`: sparse satır capture'ı bozmasın.
      ...(row.credit != null ? { settledSaleAmount: new Decimal(row.credit).mul(quantity) } : {}),
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
  if (row.paymentOrderId !== null && row.paymentDate !== null) {
    await tx.order.updateMany({
      where: { id: order.id, paymentOrderId: null },
      data: {
        paymentOrderId: BigInt(row.paymentOrderId),
        paymentDate: new Date(row.paymentDate),
      },
    });
  }

  return { applied: true };
}
