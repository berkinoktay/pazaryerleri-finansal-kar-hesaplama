// Platform Service Fee (PSF) settlement row → OrgPeriodFee
// PLATFORM_SERVICE audit insert (PR-7 commit 4).
//
// Trendyol filter:
//   transactionType=DeductionInvoices, transactionSubType=PlatformServiceFee
// (settings.ts FetchOtherFinancialsOpts hides the wire detail.)
//
// Design §5.2 line 1099 + §3.7: PSF T+~7 invoice is audit-only — the
// per-order PSF ESTIMATE was written deterministically by
// applyEstimateOnOrderCreate at order arrival (T+0). This audit row
// lets reconciliation compare aggregate ESTIMATE vs aggregate invoice
// without overwriting the ESTIMATE.
//
// KDV: PSF is invoiced GROSS at %20 (sabit Trendyol convention,
// design §12.2 #1). Split: net = debt / 1.20.

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';

import { insertOrgPeriodFee } from './org-period-fee';
import type { HandleSettlementResult } from './sale';

const PSF_VAT_DIVISOR = new Decimal('1.20');
const PSF_VAT_RATE = new Decimal('20');

export async function handlePsf(
  storeId: string,
  organizationId: string,
  row: TrendyolFinancialTransaction,
  tx: Prisma.TransactionClient,
): Promise<HandleSettlementResult> {
  const gross = new Decimal(row.debt);
  const amountNet = gross.div(PSF_VAT_DIVISOR).toDecimalPlaces(2);
  const vatAmount = gross.sub(amountNet);

  return insertOrgPeriodFee({
    storeId,
    organizationId,
    feeType: 'PLATFORM_SERVICE',
    row,
    amounts: { amountNet, vatRate: PSF_VAT_RATE, vatAmount },
    tx,
    logScope: 'settlements.psf',
  });
}
