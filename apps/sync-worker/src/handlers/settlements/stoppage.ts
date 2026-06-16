// E-ticaret Stopajı settlement row → OrgPeriodFee STOPPAGE audit insert
// (PR-7 commit 4).
//
// Trendyol filter:
//   transactionType=Stoppage  (otherfinancials)
//
// Design §5.2 line 1098: Stopaj %1 of saleGross, KDV YOK. The per-order
// ESTIMATE was deterministically computed at T+0; this row audits the
// aggregate Trendyol invoice. Research §4.3: bir PaymentOrder cycle birden
// fazla paymentDate içerebilir → 2+ Stoppage rows possible. Each row is
// inserted independently (no aggregation) because Trendyol's `id` is unique
// per row.
//
// KDV: zero. GROSS CONVENTION (2026-06-16, Bölüm E Task 20): debt doğrudan
// amountGross; vatRate=0. Net-split kaldırıldı (KDV = 0 zaten).

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
  return insertOrgPeriodFee({
    storeId,
    organizationId,
    feeType: 'STOPPAGE',
    row,
    amounts: { amountGross: new Decimal(row.debt), vatRate: ZERO },
    tx,
    logScope: 'settlements.stoppage',
  });
}
