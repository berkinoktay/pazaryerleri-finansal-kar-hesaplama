import { ProfitIssueCode, ProfitLineCertainty, ProfitLineType } from '@pazarsync/db/enums';

import { type ProfitIssue } from '../core/profit-issue';
import { type ProfitLine } from '../core/profit-line';

/** The shipping legs a seller-cargo-agreement estimate can leave as an estimate. */
const SELLER_CARGO_SHIPPING_TYPES: ReadonlySet<ProfitLineType> = new Set([
  ProfitLineType.SHIPPING,
  ProfitLineType.RETURN_SHIPPING,
]);

/**
 * The statement issues a reader should still show, given the lines its view selected.
 *
 * Each statement view stores its own issues: the engine already leaves out of the
 * best-known list a shipping cause whose leg a cargo invoice billed (see `issuesForView`),
 * so the status and the stored list agree. What is left here is a display rule over the
 * selected lines:
 *
 * - SELLER_CARGO_AGREEMENT_ESTIMATE is dropped once a cargo invoice replaced every
 *   shipping estimate: at least one selected SHIPPING or RETURN_SHIPPING line is ACTUAL
 *   and none is an ESTIMATE. While a shipping leg is still an estimate the notice stays,
 *   and so does it when the statement carries no shipping line at all (the desi is
 *   unknown, say): nothing replaced the estimate, the seller still has to act.
 * - CARRIER_NOT_RECOGNIZED is dropped once an ACTUAL SHIPPING line is selected, and while
 *   a SELLER_CARGO_AGREEMENT_ESTIMATE notice is shown. The current engine never stores it
 *   in either case (the invoice lifts it in the best-known view, and a seller-cargo order
 *   never records it), so this only matters for a statement an engine before version 12
 *   wrote, where the issue sat beside a zero shipping estimate; the stale sweep rewrites
 *   such statements, and until it does, this keeps their notices consistent.
 * - Every other code is returned as it is.
 */
export function visibleProfitIssues(
  issues: readonly ProfitIssue[],
  selectedLines: readonly ProfitLine[],
): readonly ProfitIssue[] {
  const shippingIsActual = selectedLines.some(
    (line) =>
      line.type === ProfitLineType.SHIPPING && line.certainty === ProfitLineCertainty.ACTUAL,
  );
  const sellerCargoLines = selectedLines.filter((line) =>
    SELLER_CARGO_SHIPPING_TYPES.has(line.type),
  );
  const sellerCargoInvoiced =
    sellerCargoLines.length > 0 &&
    sellerCargoLines.every((line) => line.certainty === ProfitLineCertainty.ACTUAL);
  const sellerCargoNoticeShown =
    !sellerCargoInvoiced &&
    issues.some((issue) => issue.code === ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE);
  return issues.filter((issue) => {
    if (issue.code === ProfitIssueCode.CARRIER_NOT_RECOGNIZED) {
      return !shippingIsActual && !sellerCargoNoticeShown;
    }
    if (issue.code === ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE) {
      return !sellerCargoInvoiced;
    }
    return true;
  });
}
