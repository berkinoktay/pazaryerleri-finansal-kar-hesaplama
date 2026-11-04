import { type ProfitIssueCode } from '@pazarsync/db/enums';

/**
 * A single calculation problem attached to an order. `orderItemId` scopes the
 * issue to one item when it is item-specific; `detail` carries optional context
 * (English, for logs). The caller localizes from `code`.
 */
export interface ProfitIssue {
  readonly code: ProfitIssueCode;
  readonly orderItemId: string | null;
  readonly detail: string | null;
}

/**
 * Per-code flags for each profit issue.
 *
 * `blocking` makes the order NOT_COMPUTABLE (see `deriveProfitStatus`); a non-blocking
 * one stays a visible warning. An unmapped marketplace record is deliberately
 * non-blocking so a new record type does not turn every order "not computable" at once.
 * An ambiguous record match is a warning for the same reason: like an unmapped record,
 * it leaves the order's own estimate intact.
 *
 * `settlementGap` marks a settlement-required slot the engine left without any line,
 * because it could neither estimate it nor read an actual for it (it could not estimate
 * shipping or resolve a commission rate). With no line in that slot nothing is "pending",
 * so without this flag reconciliation would read FULLY_SETTLED even though the real
 * record never arrived; it instead holds reconciliation at PARTIALLY_SETTLED (see
 * `deriveReconciliationStatus`). Every settlement-gap code is also blocking.
 */
export const PROFIT_ISSUE_CATALOG = {
  MISSING_COST: { blocking: true, settlementGap: false },
  SHIPPING_ESTIMATE_UNAVAILABLE: { blocking: true, settlementGap: true },
  UNMAPPED_MARKETPLACE_RECORD: { blocking: false, settlementGap: false },
  MISSING_COMMISSION_RATE: { blocking: true, settlementGap: true },
  AMBIGUOUS_RECORD_MATCH: { blocking: false, settlementGap: false },
} as const satisfies Record<
  ProfitIssueCode,
  { readonly blocking: boolean; readonly settlementGap: boolean }
>;

/** Returns true when the issue blocks the profit calculation. */
export function isBlockingIssue(issue: ProfitIssue): boolean {
  return PROFIT_ISSUE_CATALOG[issue.code].blocking;
}

/**
 * Returns true when the issue marks a settlement-required slot the engine left
 * without any line. A standing settlement-gap issue holds reconciliation at
 * PARTIALLY_SETTLED (see `deriveReconciliationStatus`).
 */
export function isSettlementGapIssue(issue: ProfitIssue): boolean {
  return PROFIT_ISSUE_CATALOG[issue.code].settlementGap;
}
