import type { Prisma } from '@pazarsync/db';
import { ProfitIssueCode, ProfitStatus } from '@pazarsync/db/enums';
import { isBlockingIssue, parseStoredIssues, type ProfitIssue } from '@pazarsync/profit';

/**
 * One reason an order's profit is not computable: a blocking issue of its best-known
 * statement, reduced to what the seller is shown (the code the frontend localizes, and the
 * detail its copy may name, e.g. the carrier name). The wire shape is `ProfitBlocker`, on
 * the orders list row and the order detail; both read the best-known view, so a blocker
 * shows only while the order's profit is really not computable.
 */
export interface ProfitBlocker {
  readonly code: ProfitIssueCode;
  readonly detail: string | null;
}

/** The view a blocker list reads: a statement view's status and its issues. */
export interface ProfitBlockerSource {
  readonly status: ProfitStatus;
  readonly issues: readonly ProfitIssue[];
}

/** The enum declaration order, the primary sort key of a blocker list. */
const ISSUE_CODE_ORDER: readonly ProfitIssueCode[] = Object.values(ProfitIssueCode);

/** Code in enum order, then detail with null first; plain comparison, no locale. */
function compareBlockers(a: ProfitBlocker, b: ProfitBlocker): number {
  const byCode = ISSUE_CODE_ORDER.indexOf(a.code) - ISSUE_CODE_ORDER.indexOf(b.code);
  if (byCode !== 0) return byCode;
  if (a.detail === b.detail) return 0;
  if (a.detail === null) return -1;
  if (b.detail === null) return 1;
  return a.detail < b.detail ? -1 : 1;
}

/**
 * The blockers of one statement view. Only a NOT_COMPUTABLE view has any: its blocking
 * issues (`isBlockingIssue`) as `{ code, detail }`, one entry per distinct code + detail
 * (the same cause named on several items is one blocker), in a stable order. Every other
 * status (computed, excluded, cancelled) has none, whatever codes it stores. This is the
 * only place the API decides which issue blocks; the frontend renders the result.
 */
export function profitBlockers(view: ProfitBlockerSource): ProfitBlocker[] {
  if (view.status !== ProfitStatus.NOT_COMPUTABLE) return [];

  const seen = new Set<string>();
  const blockers: ProfitBlocker[] = [];
  for (const issue of view.issues) {
    if (!isBlockingIssue(issue)) continue;
    const key = JSON.stringify([issue.code, issue.detail]);
    if (seen.has(key)) continue;
    seen.add(key);
    blockers.push({ code: issue.code, detail: issue.detail });
  }
  return blockers.sort(compareBlockers);
}

/**
 * `profitBlockers` over a stored statement row, whose issues are raw JSON. The issues are
 * parsed only for a NOT_COMPUTABLE row (every other status has no blockers), so a corrupt
 * value on any other row is never read. A corrupt value on a NOT_COMPUTABLE row throws
 * `InvalidStoredProfitDataError`; the caller decides how its surface degrades.
 */
export function storedProfitBlockers(row: {
  readonly status: ProfitStatus;
  readonly issues: Prisma.JsonValue;
}): ProfitBlocker[] {
  if (row.status !== ProfitStatus.NOT_COMPUTABLE) return [];
  return profitBlockers({ status: row.status, issues: parseStoredIssues(row.issues) });
}
