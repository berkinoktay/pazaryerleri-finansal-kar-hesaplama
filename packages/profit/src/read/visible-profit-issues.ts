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
 * Issues are stored with the statement, independent of the view: the engine records
 * what it saw while estimating, and a later actual can make a warning moot without the
 * issue itself going away. Whether a warning is still meaningful is therefore derived
 * here, on read, from the selected lines:
 *
 * - CARRIER_NOT_RECOGNIZED is dropped once an ACTUAL SHIPPING line is selected -- the
 *   cargo invoice replaced the zero estimate the warning was about.
 * - SELLER_CARGO_AGREEMENT_ESTIMATE is dropped once no selected SHIPPING or
 *   RETURN_SHIPPING line is an ESTIMATE -- a cargo invoice arrived for every leg, so no
 *   estimate is left for the warning to explain. While at least one shipping leg is
 *   still an estimate, the warning stays.
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
  const shippingEstimateRemains = selectedLines.some(
    (line) =>
      SELLER_CARGO_SHIPPING_TYPES.has(line.type) && line.certainty === ProfitLineCertainty.ESTIMATE,
  );
  return issues.filter((issue) => {
    if (issue.code === ProfitIssueCode.CARRIER_NOT_RECOGNIZED) {
      return !shippingIsActual;
    }
    if (issue.code === ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE) {
      return shippingEstimateRemains;
    }
    return true;
  });
}
