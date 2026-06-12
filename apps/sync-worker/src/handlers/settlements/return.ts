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
//      split at the fixed 20% commission-VAT convention —
//      TRENDYOL_COMMISSION_VAT_RATE, shared in @pazarsync/marketplace)
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
// Idempotency (#297): handler checks `(orderId, source=SETTLEMENT,
// trendyolTransactionId = row.id)` BEFORE insert — indexed column
// equality, not a JSONB path. All three legs share the same
// trendyolTransactionId and differ by feeType; the DB-level partial
// unique (order_id, fee_type, trendyol_transaction_id) WHERE
// source='SETTLEMENT' makes a double write impossible even if the
// pre-check races. externalRef stays as an audit-only JSON blob.
//
// #299: every leg also carries orderClaimItemId — the specific returned
// UNIT (OrderClaimItem). Selection = inherit-from-existing-legs, else the
// oldest fee-free unit on the matching line; an unconditional updateMany
// backfill heals the settlements-before-claims cron ordering (:30 vs :45).
//
// feeDefinitionId is left NULL — schema makes it nullable (line 959) and
// settlement-sourced fees have no fee_definition entry (deterministic
// ESTIMATE rows do, settlement rows don't).

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import {
  TRENDYOL_COMMISSION_VAT_DIVISOR,
  TRENDYOL_COMMISSION_VAT_RATE,
  type TrendyolFinancialTransaction,
} from '@pazarsync/marketplace';
import { recomputeSettledProfit } from '@pazarsync/profit';
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

  // Order match — LAYERED (issue #291 live finding, proven 6/6 against
  // claims data): the Return row's shipmentPackageId is the RETURN
  // parcel's id, NOT the original outbound package — a direct
  // platformOrderId lookup never matched on prod, silently skipping
  // every refund since PR-7.
  //   1. platformOrderId == row.shipmentPackageId (kept — defensive)
  //   2. OrderClaim bridge: the claims sync stores the return-parcel id
  //      in the indexed orderShipmentPackageId column (#298) — exact,
  //      store-safe via the denormalized storeId
  //   3. orderNumber + barcode single-candidate fallback (claim not
  //      synced yet); ambiguous → skip + natural 6h retry
  const platformOrderId = row.shipmentPackageId.toString();
  let order = await tx.order.findFirst({
    where: { storeId, platformOrderId },
    select: { id: true, organizationId: true, settledNetProfit: true },
  });

  if (order === null) {
    const claim = await tx.orderClaim.findFirst({
      where: { storeId, orderShipmentPackageId: platformOrderId },
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
  // snapshot entered AFTER the first poll (a late variant-resolution
  // link on a non-excluded order) could never backfill its COST_RETURN.
  // Each leg now checks its own existence under the shared trendyolId,
  // letting the 6h re-poll self-heal missing legs (including rows
  // written before this fix that carry only the deduction).
  const existingLegs = await tx.orderFee.findMany({
    where: {
      orderId: order.id,
      source: 'SETTLEMENT',
      trendyolTransactionId: row.id,
    },
    select: { feeType: true, orderClaimItemId: true },
  });
  const hasLeg = new Set(existingLegs.map((f) => f.feeType));
  let wroteAnyLeg = false;

  // #299: pick the returned UNIT this trio belongs to. INHERIT first — if
  // an earlier poll already linked some legs, a late leg (self-healed
  // COST_RETURN after the cost snapshot arrives) must stay on the SAME
  // unit; falling through to the greedy pick would split the trio across
  // units when more free units exist. Greedy ("first free unit") only
  // applies to a brand-new trio; null when the claim isn't synced yet —
  // the unconditional backfill below heals it on the next re-poll.
  const inheritedClaimItemId =
    existingLegs.find((l) => l.orderClaimItemId !== null)?.orderClaimItemId ?? null;
  const selectedClaimItem =
    inheritedClaimItemId !== null
      ? null
      : await tx.orderClaimItem.findFirst({
          where: {
            orderItemId: item.id,
            claim: { orderId: order.id },
            fees: { none: {} },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
  const orderClaimItemId = inheritedClaimItemId ?? selectedClaimItem?.id ?? null;

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

  // Audit-only blob — idempotency reads NEVER touch this (column below).
  const externalRef = {
    trendyolId: row.id,
    sellerId: row.sellerId,
    ...(row.receiptId !== null ? { receiptId: row.receiptId } : {}),
    ...(row.paymentOrderId !== null ? { paymentOrderId: row.paymentOrderId } : {}),
  };
  const trendyolTransactionId = row.id;

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
        trendyolTransactionId,
        orderClaimItemId,
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
    // row.commissionAmount arrives KDV-dahil, same fixed %20 convention as
    // the sale-side commission this credit reverses (shared constant, #300).
    const commissionGross = new Decimal(row.commissionAmount);
    const commissionNet = commissionGross.div(TRENDYOL_COMMISSION_VAT_DIVISOR).toDecimalPlaces(2);
    await tx.orderFee.create({
      data: {
        orderId: order.id,
        organizationId: order.organizationId,
        feeType: 'COMMISSION_REFUND',
        source: 'SETTLEMENT',
        direction: 'CREDIT',
        amountNet: commissionNet,
        vatRate: new Decimal(TRENDYOL_COMMISSION_VAT_RATE),
        vatAmount: commissionGross.sub(commissionNet),
        displayName: 'Komisyon iadesi',
        trendyolTransactionId,
        orderClaimItemId,
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
        trendyolTransactionId,
        orderClaimItemId,
        externalRef,
      },
    });
    wroteAnyLeg = true;
  } else if (!hasLeg.has('COST_RETURN')) {
    syncLog.warn('settlements.return.cost-snapshot-missing', { id: row.id, itemId: item.id });
  }

  // #299 backfill — UNCONDITIONAL: the settlements cron (:30) fires before
  // the claims cron (:45), so a fresh return's trio is often written with
  // null links; later re-polls skip every leg (idempotent no-op) and would
  // never link without this. Also covers the partial case where only the
  // newly-written leg got the link. Idempotent + cheap (≤3 rows).
  if (orderClaimItemId !== null) {
    await tx.orderFee.updateMany({
      where: {
        orderId: order.id,
        source: 'SETTLEMENT',
        trendyolTransactionId,
        orderClaimItemId: null,
      },
      data: { orderClaimItemId },
    });
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
