// fastDelivery correction OrderFee — client-side derived (PR-7 commit 7).
//
// Design §3.5 line 412-414: when an order's fastDelivery flag is true AND
// the actual delivery landed on or before the agreed date, Trendyol
// applies the discounted PSF rate (₺6.99 instead of ₺10.99). At T+0 we
// don't know if delivery will be on-time, so applyEstimateOnOrderCreate
// writes the conservative ₺10.99 PSF. Once the cycle confirms the order
// was delivered on time, we write a CREDIT OrderFee that pulls the net
// effective PSF down to ₺6.99 (₺4.00 net + ₺0.80 KDV = ₺4.80 gross
// reduction).
//
// Source attribution: Trendyol does NOT emit a separate settlement row
// for this discount — the seller's PSF invoice already reflects the
// reduced rate (research §4.4 spot check confirms this is implicit, not
// itemised). We derive the correction from our own delivery-time data
// and stamp the indexed `derivedFrom` column (= 'fast-delivery') so audit
// can distinguish settled-from-Trendyol fees from client-derived
// corrections. There is no Trendyol transaction behind this row, so
// trendyolTransactionId stays NULL — the (order_id, fee_type,
// derived_from) partial unique is the DB-level guard instead (#297):
// one correction per order, enforced by schema, not code discipline.
//
// Source enum: SETTLEMENT (no SYSTEM_DERIVED enum value exists; adding
// one would require a mini-migration that's out of PR-7 scope). The
// `derivedFrom` column carries the distinction.
//
// PR-9 invariant: this writes a NEW OrderFee CREDIT row; the existing
// ESTIMATE PSF DEBIT row is untouched. recomputeSettledProfit aggregates
// both rows and the net effect lands ₺4.00 lower than the conservative
// estimate would have predicted.

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import { inferDeliveredOnTime } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

const FAST_CORRECTION_NET = new Decimal('4.00');
const FAST_CORRECTION_VAT_RATE = new Decimal('20');
const FAST_CORRECTION_VAT_AMOUNT = new Decimal('0.80');

/** derivedFrom marker — the idempotency key for this client-derived row. */
const FAST_DELIVERY_MARKER = 'fast-delivery';

export interface ApplyFastDeliveryCorrectionResult {
  applied: boolean;
  skipReason?:
    | 'order_not_found'
    | 'not_fast_delivery'
    | 'not_on_time'
    | 'delivery_data_incomplete'
    | 'already_applied';
}

export async function applyFastDeliveryCorrection(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<ApplyFastDeliveryCorrectionResult> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      organizationId: true,
      fastDelivery: true,
      agreedDeliveryDate: true,
      actualDeliveryDate: true,
    },
  });
  if (order === null) return { applied: false, skipReason: 'order_not_found' };
  if (!order.fastDelivery) return { applied: false, skipReason: 'not_fast_delivery' };

  const onTime = inferDeliveredOnTime(order);
  if (onTime === null) {
    return { applied: false, skipReason: 'delivery_data_incomplete' };
  }
  if (onTime === false) return { applied: false, skipReason: 'not_on_time' };

  // Idempotency (#297) — detect prior correction via the indexed derivedFrom
  // column. The lookup matches the (order_id, fee_type, derived_from)
  // partial unique exactly, so the DB guard can never fire a violation the
  // pre-check did not predict.
  const existing = await tx.orderFee.findFirst({
    where: {
      orderId,
      feeType: 'PLATFORM_SERVICE',
      derivedFrom: FAST_DELIVERY_MARKER,
    },
    select: { id: true },
  });
  if (existing !== null) return { applied: false, skipReason: 'already_applied' };

  await tx.orderFee.create({
    data: {
      orderId,
      organizationId: order.organizationId,
      feeType: 'PLATFORM_SERVICE',
      source: 'SETTLEMENT',
      direction: 'CREDIT',
      amountNet: FAST_CORRECTION_NET,
      vatRate: FAST_CORRECTION_VAT_RATE,
      vatAmount: FAST_CORRECTION_VAT_AMOUNT,
      displayName: 'Bugün Kargoda PSF İndirimi',
      derivedFrom: FAST_DELIVERY_MARKER,
      // Audit-only blob — idempotency reads use the column above.
      externalRef: {
        derivedFrom: FAST_DELIVERY_MARKER,
        psfDiscountNet: FAST_CORRECTION_NET.toFixed(2),
        psfDiscountVat: FAST_CORRECTION_VAT_AMOUNT.toFixed(2),
      },
    },
  });

  syncLog.info('settlements.fast-delivery-correction.applied', {
    orderId,
    netDiscount: FAST_CORRECTION_NET.toFixed(2),
  });

  return { applied: true };
}
