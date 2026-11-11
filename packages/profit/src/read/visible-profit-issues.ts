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
 *   cargo invoice replaced the zero estimate the warning was about. It is also dropped
 *   while a SELLER_CARGO_AGREEMENT_ESTIMATE warning is shown: on such an order no cargo
 *   invoice is coming, so the two notices would contradict each other, and the step the
 *   seller-cargo notice asks for (entering the store's own tariff) resolves both.
 * - SELLER_CARGO_AGREEMENT_ESTIMATE is dropped once a cargo invoice replaced every
 *   shipping estimate: at least one selected SHIPPING or RETURN_SHIPPING line is ACTUAL
 *   and none is an ESTIMATE. While a shipping leg is still an estimate the warning
 *   stays, and so does it when the statement carries no shipping line at all (the desi
 *   is unknown, say): nothing replaced the estimate, the seller still has to act.
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
