// E-ticaret Stopajı settlement row → OrgPeriodFee STOPPAGE audit insert
// (PR-7 commit 4).
//
// Trendyol filter:
//   transactionType=Stoppage  (otherfinancials)
//
// Stopaj %1 oranındadır; matrah per-order ESTIMATE'te NET satış (saleGross −
// saleVat), bkz. estimate-on-order-create.ts. Bu settlement satırı ise
// Trendyol'un faturaladığı `debt` tutarını doğrudan denetim olarak kaydeder
// (matrah seçmez). Research §4.3: bir PaymentOrder cycle birden fazla
// paymentDate içerebilir → 2+ Stoppage rows possible. Each row is inserted
// independently (no aggregation) because Trendyol's `id` is unique per row.
//
// KDV: stopaj YAPISAL olarak KDV taşımaz (vergi tevkifatı) → vatRate verilmez;
// insertOrgPeriodFee 0 yazar. GROSS CONVENTION (2026-06-16, Bölüm E Task 20):
// debt doğrudan amountGross; net-split kaldırıldı (KDV = 0 zaten).

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';

import { insertOrgPeriodFee } from './org-period-fee';
import type { HandleSettlementResult } from './sale';

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
    amounts: { amountGross: new Decimal(row.debt) },
    tx,
    logScope: 'settlements.stoppage',
  });
}
