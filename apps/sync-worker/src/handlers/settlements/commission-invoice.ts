// Komisyon Faturası ("Commission Invoice") otherfinancials/DeductionInvoices
// sub-class row → CommissionInvoice upsert + OrderItem.commissionInvoiceId
// batch backfill (PR-7 commit 6).
//
// Design §3.8 (two-stage populate):
//   - commissionInvoiceSerialNumber: Sale settlement row writes the raw
//     string at T+~5 (handleSale, PR-7 commit 3).
//   - commissionInvoiceId FK: this handler backfills when the
//     otherfinancials "Komisyon Faturası" row arrives at T+~7. 1:N
//     mapping — one CommissionInvoice fans out to all OrderItems whose
//     commissionInvoiceSerialNumber matches.
//
// Upsert key: schema declares `@@unique([storeId, trendyolSerialNumber])`
// (line 1100). Cross-store collisions safe; same serial in a different
// store creates an independent row.
//
// KDV split: commission invoice debt is KDV-dahil; %20 sabit Trendyol
// convention (design §12.2 #1) → totalNet = debt / 1.20.
//
// Period: schema's periodStart/periodEnd are NOT NULL. V1 pragmatic —
// use paymentDate for both (weekly invoice represented by a single date).
// Stage validation (commit 9) may surface a true period range; extension
// scheduled for V2.
//
// Tenant filter on the OrderItem batch UPDATE uses OrderItem.organizationId
// (denormalized, PR-1). storeId join via Order would require findMany +
// loop; the denormalized column makes a single SQL UPDATE possible.

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import {
  TRENDYOL_COMMISSION_VAT_DIVISOR,
  type TrendyolFinancialTransaction,
} from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

import type { HandleSettlementResult } from './sale';

export interface HandleCommissionInvoiceResult extends HandleSettlementResult {
  /** Number of OrderItem rows that received the FK. Useful for telemetry. */
  backfilledItemCount?: number;
}

export async function handleCommissionInvoice(
  storeId: string,
  organizationId: string,
  row: TrendyolFinancialTransaction,
  tx: Prisma.TransactionClient,
): Promise<HandleCommissionInvoiceResult> {
  if (row.paymentOrderId === null || row.paymentDate === null) {
    syncLog.warn('settlements.commission-invoice.sparse', {
      id: row.id,
      paymentOrderId: row.paymentOrderId,
      paymentDate: row.paymentDate,
    });
    return { applied: false, skipReason: 'sparse_field' };
  }

  // row.id is the invoice serial number — matches Sale's
  // commissionInvoiceSerialNumber field (research §3.1 confirms paket-level
  // per-shipment uses the same serial).
  const trendyolSerialNumber = row.id;
  const paymentDate = new Date(row.paymentDate);
  const gross = new Decimal(row.debt);
  const totalNet = gross.div(TRENDYOL_COMMISSION_VAT_DIVISOR).toDecimalPlaces(2);
  const totalVat = gross.sub(totalNet);

  const invoice = await tx.commissionInvoice.upsert({
    where: {
      storeId_trendyolSerialNumber: { storeId, trendyolSerialNumber },
    },
    create: {
      organizationId,
      storeId,
      trendyolSerialNumber,
      periodStart: paymentDate,
      periodEnd: paymentDate,
      totalNet,
      totalVat,
      paymentOrderId: BigInt(row.paymentOrderId),
      paymentDate,
    },
    update: {
      // Re-poll cron may resurface the same invoice with corrected metadata
      // (e.g. payment date shifted between observation passes). Keep
      // totals + payment info in sync; serial + period stay anchored to
      // first insert.
      totalNet,
      totalVat,
      paymentOrderId: BigInt(row.paymentOrderId),
      paymentDate,
    },
  });

  // Batch backfill OrderItem.commissionInvoiceId. The `commissionInvoiceId:
  // null` filter is the idempotency anchor — items that already point to
  // this (or any) invoice are left alone. organizationId scopes the update
  // to the tenant; cross-tenant items with the same serial (unusual but
  // possible) get their own invoice row.
  const updateResult = await tx.orderItem.updateMany({
    where: {
      organizationId,
      commissionInvoiceSerialNumber: trendyolSerialNumber,
      commissionInvoiceId: null,
    },
    data: { commissionInvoiceId: invoice.id },
  });

  return { applied: true, backfilledItemCount: updateResult.count };
}
