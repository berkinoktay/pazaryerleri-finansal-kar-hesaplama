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
 * Whether each issue code blocks the profit calculation. A blocking issue makes
 * the order NOT_COMPUTABLE (see `deriveProfitStatus`); a non-blocking one stays a
 * visible warning. An unmapped marketplace record is deliberately non-blocking so
 * a new record type does not turn every order "not computable" at once. An
 * ambiguous record match is a warning for the same reason: like an unmapped
 * record, it leaves the order's own estimate intact.
 */
export const PROFIT_ISSUE_CATALOG = {
  MISSING_COST: { blocking: true },
  MISSING_FX_RATE: { blocking: true },
  SHIPPING_ESTIMATE_UNAVAILABLE: { blocking: true },
  UNMAPPED_MARKETPLACE_RECORD: { blocking: false },
  MISSING_COMMISSION_RATE: { blocking: true },
  AMBIGUOUS_RECORD_MATCH: { blocking: false },
} as const satisfies Record<ProfitIssueCode, { readonly blocking: boolean }>;

/** Returns true when the issue blocks the profit calculation. */
export function isBlockingIssue(issue: ProfitIssue): boolean {
  return PROFIT_ISSUE_CATALOG[issue.code].blocking;
}
