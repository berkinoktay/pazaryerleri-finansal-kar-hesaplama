// Reklam Bedeli (advertising) settlement row → OrgPeriodFee ADVERTISING
// org-level insert (PR-7 commit 4).
//
// Trendyol dispatcher path:
//   transactionType=DeductionInvoices  →  response transactionType="Reklam Bedeli"
// (Sub-classified by settlements-dispatcher.classifyDeductionInvoice.)
//
// Master guide §Current Status 2026-05-21 Aşama 2 audit:
//   Design §5.2 line 1101 — V1'de API'den OrgPeriodFee ADVERTISING.
//   §3.3 "manual entry V1" satırı eski; resmi karar API kullanımı.
//
// KDV: Trendyol invoice KDV-dahil/hariç convention'ı research §4.4'te
// "TODO" işaretli. V1 pragmatic — debt doğrudan gross (flat-zero KDV).
// GROSS CONVENTION (2026-06-16, Bölüm E Task 20): amountGross = debt; vatRate = 0.
// Stage E2E validation bu varsayımı doğrular; gerekirse follow-up'ı KDV split eklenir.
//
// Order-level attribution YOK — Reklam org düzeyinde, hangi siparişe ait
// olduğu Trendyol tarafından söylenmiyor. UI'da raporlama org-level toplam.

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';

import { insertOrgPeriodFee } from './org-period-fee';
import type { HandleSettlementResult } from './sale';

const ZERO = new Decimal('0');

export async function handleAdvertising(
  storeId: string,
  organizationId: string,
  row: TrendyolFinancialTransaction,
  tx: Prisma.TransactionClient,
): Promise<HandleSettlementResult> {
  return insertOrgPeriodFee({
    storeId,
    organizationId,
    feeType: 'ADVERTISING',
    row,
    amounts: { amountGross: new Decimal(row.debt), vatRate: ZERO },
    tx,
    logScope: 'settlements.advertising',
  });
}
