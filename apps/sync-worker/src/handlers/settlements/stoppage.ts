// E-ticaret Stopajı settlement row → OrgPeriodFee STOPPAGE audit insert
// (PR-7 commit 4).
//
// Trendyol filter:
//   transactionType=Stoppage  (otherfinancials)
//
// Design §5.2 line 1098: Stopaj %1 of saleSubtotalNet, KDV YOK. The per-order
// ESTIMATE was deterministically computed at T+0; this row audits the
// aggregate Trendyol invoice. Research §4.3: bir PaymentOrder cycle birden
// fazla paymentDate içerebilir → 2+ Stoppage rows possible. Each row is
// inserted independently (no aggregation) because Trendyol's `id` is unique
// per row.
//
// KDV: zero. amountNet = debt direkt; vatRate / vatAmount = 0.

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';

import { insertOrgPeriodFee } from './org-period-fee';
import type { HandleSettlementResult } from './sale';

const ZERO = new Decimal('0');

export async function handleStoppage(
  storeId: string,
  organizationId: string,
  row: TrendyolFinancialTransaction,
  tx: Prisma.TransactionClient,
): Promise<HandleSettlementResult> {
  const amountNet = new Decimal(row.debt);

  return insertOrgPeriodFee({
    storeId,
    organizationId,
    feeType: 'STOPPAGE',
    row,
    amounts: { amountNet, vatRate: ZERO, vatAmount: ZERO },
    tx,
    logScope: 'settlements.stoppage',
  });
}
