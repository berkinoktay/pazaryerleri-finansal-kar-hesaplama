import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineSource,
  ProfitLineType,
  ProfitStatementView,
} from '@pazarsync/db/enums';

import { type ProfitIssue, RETURN_SHIPPING_ISSUE_DETAIL_PREFIX } from './profit-issue';
import { type ProfitLine } from './profit-line';

/** The two shipping legs of a parcel, each billed by its own cargo invoice line. */
type ShippingLeg = 'OUTBOUND' | 'RETURN';

/** The parcel-level line type that carries each leg's shipping cost. */
const SHIPPING_LEG_LINE_TYPE: Readonly<Record<ShippingLeg, ProfitLineType>> = {
  OUTBOUND: ProfitLineType.SHIPPING,
  RETURN: ProfitLineType.RETURN_SHIPPING,
};

/**
 * The shipping leg an issue is caused by, or null when the cargo does not cause it.
 * CARRIER_NOT_RECOGNIZED is raised only by the outbound leg; a SHIPPING_ESTIMATE_UNAVAILABLE
 * belongs to the return leg when its detail carries the return prefix, otherwise (a null
 * detail included) to the outbound leg. A new issue code fails to compile here until it is
 * placed on one side.
 */
function shippingLegOf(issue: ProfitIssue): ShippingLeg | null {
  switch (issue.code) {
    case ProfitIssueCode.CARRIER_NOT_RECOGNIZED:
      return 'OUTBOUND';
    case ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE:
      return issue.detail !== null && issue.detail.startsWith(RETURN_SHIPPING_ISSUE_DETAIL_PREFIX)
        ? 'RETURN'
        : 'OUTBOUND';
    case ProfitIssueCode.MISSING_COST:
    case ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD:
    case ProfitIssueCode.MISSING_COMMISSION_RATE:
    case ProfitIssueCode.AMBIGUOUS_RECORD_MATCH:
    case ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE:
    case ProfitIssueCode.REFERENCE_DATA_MISSING:
      return null;
    default: {
      const exhaustive: never = issue.code;
      throw new Error(`Unhandled profit issue code: ${String(exhaustive)}`);
    }
  }
}

/** True when the view selected an actual cargo-invoice line for the leg. */
function isLegInvoiced(selectedLines: readonly ProfitLine[], leg: ShippingLeg): boolean {
  const type = SHIPPING_LEG_LINE_TYPE[leg];
  return selectedLines.some(
    (line) =>
      line.type === type &&
      line.source === ProfitLineSource.CARGO_INVOICE &&
      line.certainty === ProfitLineCertainty.ACTUAL,
  );
}

/**
 * The issues a statement view stands on, given the lines that view selected.
 *
 * The engine records every issue it met while estimating; the estimate view is that
 * order-time estimate, so it keeps all of them. In the best-known view a cargo invoice is
 * the real cost of the shipping leg it bills, so it lifts the causes that only stood for
 * that leg's missing price:
 *
 * - an actual cargo-invoice SHIPPING line drops CARRIER_NOT_RECOGNIZED and every
 *   SHIPPING_ESTIMATE_UNAVAILABLE whose detail lacks the return prefix;
 * - an actual cargo-invoice RETURN_SHIPPING line drops every SHIPPING_ESTIMATE_UNAVAILABLE
 *   whose detail carries the return prefix.
 *
 * Every other issue stays, whatever was invoiced: a missing cost, commission rate or fee
 * definition is not about the cargo. A shipping line confirmed by a payment order is
 * ACTUAL too but is not an invoice, so it lifts nothing; neither does an invoice that wrote
 * no line (a zero amount, or a shipping VAT left unknown by a missing definition).
 *
 * Both legs are a single parcel-level slot, so no item mapping is needed. The limit: when
 * a parcel has several returns and only one is invoiced yet, the return cause is still
 * lifted, exactly as the line selection already lets that invoice stand for the whole
 * return slot.
 */
export function issuesForView(
  view: ProfitStatementView,
  issues: readonly ProfitIssue[],
  selectedLines: readonly ProfitLine[],
): readonly ProfitIssue[] {
  switch (view) {
    case ProfitStatementView.ESTIMATE:
      return issues;
    case ProfitStatementView.BEST_KNOWN: {
      const invoiced: Readonly<Record<ShippingLeg, boolean>> = {
        OUTBOUND: isLegInvoiced(selectedLines, 'OUTBOUND'),
        RETURN: isLegInvoiced(selectedLines, 'RETURN'),
      };
      return issues.filter((issue) => {
        const leg = shippingLegOf(issue);
        return leg === null || !invoiced[leg];
      });
    }
    default: {
      const exhaustive: never = view;
      throw new Error(`Unhandled profit statement view: ${String(exhaustive)}`);
    }
  }
}
