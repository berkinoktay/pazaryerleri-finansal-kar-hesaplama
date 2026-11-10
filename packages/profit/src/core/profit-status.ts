import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineSource,
  ProfitLineType,
  ProfitStatus,
  ReconciliationStatus,
} from '@pazarsync/db/enums';

import { getLineSpec } from './catalog/profit-line-catalog';
import { isBlockingIssue, isSettlementGapIssue, type ProfitIssue } from './profit-issue';
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

/**
 * The shipping legs a seller-cargo-agreement order keeps as estimates on a
 * Trendyol-contract store: no payment order ever confirms them (see map-records), so
 * while the SELLER_CARGO_AGREEMENT_ESTIMATE issue stands they are not "pending".
 */
const SELLER_CARGO_SETTLEMENT_EXEMPT_TYPES: ReadonlySet<ProfitLineType> = new Set([
  ProfitLineType.SHIPPING,
  ProfitLineType.RETURN_SHIPPING,
]);

/**
 * A settlement-required line that has not yet landed as an ACTUAL value. A shipping leg
 * of a seller-cargo-agreement estimate never lands, so it is exempt while its issue
 * stands.
 */
function isPendingRequired(line: ProfitLine, issues: readonly ProfitIssue[]): boolean {
  if (!getLineSpec(line.type).settlementRequired) {
    return false;
  }
  if (line.certainty === ProfitLineCertainty.ACTUAL) {
    return false;
  }
  return !(
    SELLER_CARGO_SETTLEMENT_EXEMPT_TYPES.has(line.type) &&
    issues.some((issue) => issue.code === ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE)
  );
}

/**
 * How far along the marketplace reconciliation each reconciliation stage is, mapped
 * to the profit status it implies. Rules 4-6 of `deriveProfitStatus` are exactly this
 * lookup applied to `deriveReconciliationStatus`, so the two can never drift apart.
 */
const PROFIT_STATUS_BY_RECONCILIATION: Record<ReconciliationStatus, ProfitStatus> = {
  [ReconciliationStatus.NOT_SETTLED]: ProfitStatus.ESTIMATED,
  [ReconciliationStatus.PARTIALLY_SETTLED]: ProfitStatus.PARTIALLY_SETTLED,
  [ReconciliationStatus.FULLY_SETTLED]: ProfitStatus.SETTLED,
};

/**
 * Derives how far a set of selected lines has reconciled with the marketplace. It
 * looks at the lines and the standing issues, ignoring exclusion and cancellation:
 * 1. no settlement-sourced ACTUAL line -> NOT_SETTLED
 * 2. a settlement-required line still pending, OR a standing settlement-gap issue
 *    (a required slot the engine left without any line) -> PARTIALLY_SETTLED
 * 3. otherwise -> FULLY_SETTLED
 * 4. a SHIPPING or RETURN_SHIPPING estimate is not pending while a
 *    SELLER_CARGO_AGREEMENT_ESTIMATE issue stands: on a Trendyol-contract store that
 *    estimate never becomes actual (owner decision 2026-11-10), so it must not hold the
 *    order at PARTIALLY_SETTLED forever.
 *
 * The settlement-gap issues matter because the slot they stand for has no line at
 * all, so `isPendingRequired` alone cannot see it: without them a statement whose
 * cargo invoice never arrived would read FULLY_SETTLED once the sale and commission
 * records land. A gap on its own never lifts the status: rule 1 still wins when no
 * settlement actual exists.
 *
 * The ESTIMATE view never selects settlement actuals, so it always comes out
 * NOT_SETTLED without any special-casing.
 */
export function deriveReconciliationStatus(
  selectedLines: readonly ProfitLine[],
  issues: readonly ProfitIssue[],
): ReconciliationStatus {
  if (!selectedLines.some(isSettlementActual)) {
    return ReconciliationStatus.NOT_SETTLED;
  }
  if (
    selectedLines.some((line) => isPendingRequired(line, issues)) ||
    issues.some(isSettlementGapIssue)
  ) {
    return ReconciliationStatus.PARTIALLY_SETTLED;
  }
  return ReconciliationStatus.FULLY_SETTLED;
}

/**
 * Derives the single profit status for an order. Rules are evaluated in order;
 * the first match wins:
 * 1. excluded -> EXCLUDED
 * 2. cancelled -> CANCELLED
 * 3. a blocking issue -> NOT_COMPUTABLE
 * 4-6. otherwise the reconciliation status (see `deriveReconciliationStatus`) mapped
 *      through PROFIT_STATUS_BY_RECONCILIATION: NOT_SETTLED -> ESTIMATED,
 *      PARTIALLY_SETTLED -> PARTIALLY_SETTLED, FULLY_SETTLED -> SETTLED
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
  // Every settlement-gap issue is also blocking, so rule 3 above has already returned
  // before this point can read one; the issues still matter here for the non-blocking
  // seller-cargo exemption (see `deriveReconciliationStatus` rule 4).
  return PROFIT_STATUS_BY_RECONCILIATION[
    deriveReconciliationStatus(params.selectedLines, params.issues)
  ];
}
