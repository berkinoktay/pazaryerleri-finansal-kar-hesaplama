// Shared helper for period-level OrgPeriodFee inserts (PSF, Stoppage,
// Advertising — PR-7 commit 4). These rows attach to a PaymentOrder cycle,
// not to a specific shipmentPackage — research §4.1 confirmed all
// order-level fields (shipmentPackageId / orderNumber / barcode) are NULL
// on otherfinancials rows.
//
// Idempotency: pre-insert findFirst on `externalRef.trendyolId` — same
// pattern as handleReturn. Json path filter avoids needing a UNIQUE index.
//
// Period model: schema has no `period` column — `paymentOrderId` is the
// cycle key, `paymentDate` is the row's settlement date. A single cycle
// can span multiple paymentDate values (research §4.3 — 2 weeks merging),
// so we insert one row per Trendyol transaction id.

import type { Decimal } from 'decimal.js';

import type { OrderFeeType, Prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

import type { HandleSettlementResult } from './sale';

export interface InsertOrgPeriodFeeOpts {
  storeId: string;
  organizationId: string;
  feeType: OrderFeeType;
  row: TrendyolFinancialTransaction;
  /** Pre-computed KDV split — each handler resolves its own VAT convention. */
  amounts: { amountNet: Decimal; vatRate: Decimal; vatAmount: Decimal };
  tx: Prisma.TransactionClient;
  /** Telemetry label for the log path (e.g. 'settlements.psf'). */
  logScope: string;
}

export async function insertOrgPeriodFee(
  opts: InsertOrgPeriodFeeOpts,
): Promise<HandleSettlementResult> {
  const { storeId, organizationId, feeType, row, amounts, tx, logScope } = opts;

  if (row.paymentOrderId === null || row.paymentDate === null) {
    syncLog.warn(`${logScope}.sparse`, {
      id: row.id,
      paymentOrderId: row.paymentOrderId,
      paymentDate: row.paymentDate,
    });
    return { applied: false, skipReason: 'sparse_field' };
  }

  // Idempotency — Trendyol id unique per transaction. Same row twice
  // means a re-poll or window overlap; skip without throwing.
  const existing = await tx.orgPeriodFee.findFirst({
    where: {
      organizationId,
      feeType,
      externalRef: { path: ['trendyolId'], equals: row.id },
    },
    select: { id: true },
  });
  if (existing !== null) return { applied: false, skipReason: undefined };

  await tx.orgPeriodFee.create({
    data: {
      organizationId,
      storeId,
      paymentOrderId: BigInt(row.paymentOrderId),
      paymentDate: new Date(row.paymentDate),
      feeType,
      source: 'SETTLEMENT',
      amountNet: amounts.amountNet,
      vatRate: amounts.vatRate,
      vatAmount: amounts.vatAmount,
      ...(row.commissionInvoiceSerialNumber !== null
        ? { invoiceSerialNumber: row.commissionInvoiceSerialNumber }
        : {}),
      ...(row.description !== null ? { description: row.description } : {}),
      externalRef: {
        trendyolId: row.id,
        sellerId: row.sellerId,
        transactionType: row.transactionType,
      },
    },
  });

  return { applied: true };
}
