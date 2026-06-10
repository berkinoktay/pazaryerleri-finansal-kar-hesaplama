// Return settlement row → three OrderFee writes + settled-profit refresh.
//
// Design §5.2 line 1088: Return.debt → OrderFee REFUND_DEDUCTION (DEBIT).
//
// Issue #291 (money-trail proof, research/2026-06-10-odeme-emri-para-izi.md):
// reconstructing payment order 58450612 (₺42,407.41) from ALL member rows
// proved Trendyol's actual cash flow nets the commission INSIDE each order
// row (`sellerRevenue = debt − commissionAmount`); the once-assumed separate
// CommissionNegative settlement row is never emitted (0 rows / 60 days).
// A returned unit therefore hands its commission back, and — product
// decision 2026-06-10, competitor parity — its cost snapshot never
// materialized (unit returned to stock). Booking only the gross
// REFUND_DEDUCTION overstated the loss by commission + unit cost.
// So one Return row now writes:
//   1. REFUND_DEDUCTION  DEBIT   from row.debt          (gross claw-back)
//   2. COMMISSION_REFUND CREDIT  from row.commissionAmount (KDV-dahil,
//      split at the fixed 20% commission-VAT convention — orders.ts
//      COMMISSION_VAT_RATE precedent)
//   3. COST_RETURN       CREDIT  from the item's unit cost snapshot
//      (one UNIT per Return row — research §3.2: per-item like Sale)
// and then refreshes Order.settledNetProfit so a late return (outside
// the PaymentOrder re-poll window) is never an orphan fee.
//
// Schema invariant: OrderFee.amountNet is NET (schema convention). The
// Trendyol Return.debt is KDV-dahil. KDV split uses the matching
// OrderItem's unitVatRate (per-line VAT, not fixed) — research §3.2
// proved Return is per-OrderItem just like Sale/Discount.
//
// Idempotency: handler checks `(orderId, source=SETTLEMENT, externalRef
// trendyolId = row.id)` BEFORE insert. All three fees share the same
// trendyolId and are written in the same transaction, so the single
// pre-check guards the trio. Re-poll cron may surface the same Return
// row multiple times; the existence check skips duplicates without
// a UNIQUE constraint (one would need a generated column to index Json).
//
// feeDefinitionId is left NULL — schema makes it nullable (line 959) and
// settlement-sourced fees have no fee_definition entry (deterministic
// ESTIMATE rows do, settlement rows don't).

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { recomputeSettledProfit } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

import type { HandleSettlementResult } from './sale';

/**
 * Commission VAT is the fixed 20% convention (orders.ts COMMISSION_VAT_RATE
 * — design §12.2 #1). row.commissionAmount arrives KDV-dahil, same as the
 * sale-side commission this credit reverses.
 */
const COMMISSION_VAT_RATE = 20;

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

  // Order match — LAYERED (issue #291 live finding, proven 6/6 against
  // claims data): the Return row's shipmentPackageId is the RETURN
  // parcel's id, NOT the original outbound package — a direct
  // platformOrderId lookup never matched on prod, silently skipping
  // every refund since PR-7.
  //   1. platformOrderId == row.shipmentPackageId (kept — defensive)
  //   2. OrderClaim bridge: PR-13 stores the return-parcel id in
  //      externalRef.orderShipmentPackageId — exact, store-safe via the
  //      claim's order relation
  //   3. orderNumber + barcode single-candidate fallback (claim not
  //      synced yet); ambiguous → skip + natural 6h retry
  const platformOrderId = row.shipmentPackageId.toString();
  let order = await tx.order.findFirst({
    where: { storeId, platformOrderId },
    select: { id: true, organizationId: true, settledNetProfit: true },
  });

  if (order === null) {
    const claim = await tx.orderClaim.findFirst({
      where: {
        order: { storeId },
        externalRef: { path: ['orderShipmentPackageId'], equals: platformOrderId },
      },
      select: { order: { select: { id: true, organizationId: true, settledNetProfit: true } } },
    });
    order = claim?.order ?? null;
  }

  if (order === null && row.orderNumber !== null) {
    const candidates = await tx.order.findMany({
      where: {
        storeId,
        platformOrderNumber: row.orderNumber,
        items: { some: { productVariant: { is: { barcode: row.barcode } } } },
      },
      select: { id: true, organizationId: true, settledNetProfit: true },
      take: 2,
    });
    if (candidates.length === 1) {
      order = candidates[0] ?? null;
    }
  }

  if (order === null) {
    syncLog.warn('settlements.return.order-not-found', {
      id: row.id,
      platformOrderId,
      orderNumber: row.orderNumber,
    });
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
    select: {
      id: true,
      unitVatRate: true,
      unitCostSnapshotNet: true,
      unitCostSnapshotVatRate: true,
      unitCostSnapshotVatAmount: true,
    },
  });
  if (item === null) {
    syncLog.warn('settlements.return.item-not-found', {
      id: row.id,
      orderId: order.id,
      variantId: variant.id,
    });
    return { applied: false, skipReason: 'item_not_found' };
  }

  // Idempotency — PER-LEG (review finding, issue #291): a single
  // REFUND_DEDUCTION pre-check made the trio one-shot, so a cost
  // snapshot entered AFTER the first poll (the product's CORE
  // \"Maliyet Bekleyen\" flow) could never backfill its COST_RETURN.
  // Each leg now checks its own existence under the shared trendyolId,
  // letting the 6h re-poll self-heal missing legs (including rows
  // written before this fix that carry only the deduction).
  const existingLegs = await tx.orderFee.findMany({
    where: {
      orderId: order.id,
      source: 'SETTLEMENT',
      externalRef: { path: ['trendyolId'], equals: row.id },
    },
    select: { feeType: true },
  });
  const hasLeg = new Set(existingLegs.map((f) => f.feeType));
  let wroteAnyLeg = false;

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

  const externalRef = {
    trendyolId: row.id,
    sellerId: row.sellerId,
    ...(row.receiptId !== null ? { receiptId: row.receiptId } : {}),
    ...(row.paymentOrderId !== null ? { paymentOrderId: row.paymentOrderId } : {}),
  };

  if (!hasLeg.has('REFUND_DEDUCTION')) {
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
        externalRef,
      },
    });
    wroteAnyLeg = true;
  }

  // 2. Commission hand-back (issue #291 money-trail proof). Null guard:
  // every observed prod row carried commissionAmount, but a sparse row
  // skips the credit loudly rather than fabricating a zero.
  if (
    !hasLeg.has('COMMISSION_REFUND') &&
    row.commissionAmount !== null &&
    row.commissionAmount !== undefined
  ) {
    const commissionGross = new Decimal(row.commissionAmount);
    const commissionDivisor = new Decimal(COMMISSION_VAT_RATE).div(100).add(1);
    const commissionNet = commissionGross.div(commissionDivisor).toDecimalPlaces(2);
    await tx.orderFee.create({
      data: {
        orderId: order.id,
        organizationId: order.organizationId,
        feeType: 'COMMISSION_REFUND',
        source: 'SETTLEMENT',
        direction: 'CREDIT',
        amountNet: commissionNet,
        vatRate: new Decimal(COMMISSION_VAT_RATE),
        vatAmount: commissionGross.sub(commissionNet),
        displayName: 'Komisyon iadesi',
        externalRef,
      },
    });
    wroteAnyLeg = true;
  } else if (!hasLeg.has('COMMISSION_REFUND')) {
    syncLog.warn('settlements.return.commission-amount-null', { id: row.id, itemId: item.id });
  }

  // 3. Cost reversal — the returned UNIT went back to stock, so its cost
  // snapshot never materialized (product decision 2026-06-10). One Return
  // row = one unit (research §3.2). Skips loudly when the snapshot is
  // still missing; the order's profit is incomputable then anyway.
  if (
    !hasLeg.has('COST_RETURN') &&
    item.unitCostSnapshotNet !== null &&
    item.unitCostSnapshotVatAmount !== null
  ) {
    await tx.orderFee.create({
      data: {
        orderId: order.id,
        organizationId: order.organizationId,
        feeType: 'COST_RETURN',
        source: 'SETTLEMENT',
        direction: 'CREDIT',
        amountNet: item.unitCostSnapshotNet,
        vatRate: item.unitCostSnapshotVatRate ?? new Decimal(0),
        vatAmount: item.unitCostSnapshotVatAmount,
        displayName: 'Maliyet iadesi',
        externalRef,
      },
    });
    wroteAnyLeg = true;
  } else if (!hasLeg.has('COST_RETURN')) {
    syncLog.warn('settlements.return.cost-snapshot-missing', { id: row.id, itemId: item.id });
  }

  if (!wroteAnyLeg) {
    // Full idempotent no-op — every leg already exists (re-poll overlap).
    return { applied: false, skipReason: undefined };
  }

  // 4. Refresh settled profit so a late return (original PaymentOrder row
  // outside the 60d re-poll window) still lands in the order's number —
  // before #291 the fee was an orphan with no recompute trigger.
  // ONLY when the payment cycle already computed a settled figure
  // (review finding #2): recomputing before the cycle confirms the
  // ESTIMATE fees would publish an inflated \"kesinleşen kâr\" for
  // weeks and break the FULLY_SETTLED invariant — the upcoming cycle
  // recomputes with the new legs anyway.
  if (order.settledNetProfit !== null) {
    await recomputeSettledProfit(order.id, tx);
  }

  return { applied: true };
}
