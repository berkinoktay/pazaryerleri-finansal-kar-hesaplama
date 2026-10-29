import { ProfitLineCertainty, ProfitLineSource, ProfitStatus } from '@pazarsync/db/enums';

import { getLineSpec } from './catalog/profit-line-catalog';
import { isBlockingIssue, type ProfitIssue } from './profit-issue';
import { type ProfitLine } from './profit-line';

export interface DeriveProfitStatusParams {
  readonly selectedLines: readonly ProfitLine[];
  readonly issues: readonly ProfitIssue[];
  readonly isCancelled: boolean;
  readonly isExcluded: boolean;
}

/**
 * An ACTUAL line whose value comes from a settlement source (a marketplace record
 * or a cargo invoice). Seller-entered or user-override ACTUAL lines do not count:
 * they do not prove the order has been reconciled with the marketplace.
 */
function isSettlementActual(line: ProfitLine): boolean {
  return (
    line.certainty === ProfitLineCertainty.ACTUAL &&
    (line.source === ProfitLineSource.MARKETPLACE_RECORD ||
      line.source === ProfitLineSource.CARGO_INVOICE)
  );
}

/** A settlement-required line that has not yet landed as an ACTUAL value. */
function isPendingRequired(line: ProfitLine): boolean {
  return getLineSpec(line.type).settlementRequired && line.certainty !== ProfitLineCertainty.ACTUAL;
}

/**
 * Derives the single profit status for an order. Rules are evaluated in order;
 * the first match wins:
 * 1. excluded -> EXCLUDED
 * 2. cancelled -> CANCELLED
 * 3. a blocking issue -> NOT_COMPUTABLE
 * 4. no settlement-sourced ACTUAL line -> ESTIMATED
 * 5. a settlement-required line still pending -> PARTIALLY_SETTLED
 * 6. otherwise -> SETTLED
 */
export function deriveProfitStatus(params: DeriveProfitStatusParams): ProfitStatus {
  if (params.isExcluded) {
    return ProfitStatus.EXCLUDED;
  }
  if (params.isCancelled) {
    return ProfitStatus.CANCELLED;
  }
  if (params.issues.some(isBlockingIssue)) {
    return ProfitStatus.NOT_COMPUTABLE;
  }
  if (!params.selectedLines.some(isSettlementActual)) {
    return ProfitStatus.ESTIMATED;
  }
  if (params.selectedLines.some(isPendingRequired)) {
    return ProfitStatus.PARTIALLY_SETTLED;
  }
  return ProfitStatus.SETTLED;
}
