import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineSource,
  ProfitLineType,
  ProfitStatementView,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine } from '../../__tests__/helpers/make-profit-line';
import { issuesForView } from '../issues-for-view';
import { type ProfitIssue } from '../profit-issue';
import { type ProfitLine } from '../profit-line';

function issue(code: ProfitIssueCode, detail: string | null = null): ProfitIssue {
  return { code, orderItemId: null, detail };
}

function invoiceLine(type: ProfitLineType): ProfitLine {
  return makeLine({
    type,
    gross: '50',
    certainty: ProfitLineCertainty.ACTUAL,
    source: ProfitLineSource.CARGO_INVOICE,
  });
}

const OUTBOUND_INVOICE = invoiceLine(ProfitLineType.SHIPPING);
const RETURN_INVOICE = invoiceLine(ProfitLineType.RETURN_SHIPPING);

const CARRIER = issue(ProfitIssueCode.CARRIER_NOT_RECOGNIZED, 'Yeni Kargo Marketplace');
const OUTBOUND_OVERFLOW = issue(ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE, 'DESI_OVERFLOW');
const OUTBOUND_NO_TARIFF = issue(
  ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
  'NO_TARIFF_VERSION',
);
const OUTBOUND_NO_DETAIL = issue(ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE);
const RETURN_UNKNOWN_DESI = issue(
  ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
  'RETURN_UNKNOWN_DESI',
);
const RETURN_NO_TARIFF = issue(
  ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
  'RETURN_NO_TARIFF_VERSION',
);

const CARGO_ISSUES: readonly ProfitIssue[] = [
  CARRIER,
  OUTBOUND_OVERFLOW,
  OUTBOUND_NO_TARIFF,
  OUTBOUND_NO_DETAIL,
  RETURN_UNKNOWN_DESI,
  RETURN_NO_TARIFF,
];

/** Every code the cargo does not cause, one issue each. */
const NON_CARGO_ISSUES: readonly ProfitIssue[] = [
  issue(ProfitIssueCode.MISSING_COST),
  issue(ProfitIssueCode.MISSING_COMMISSION_RATE),
  issue(ProfitIssueCode.REFERENCE_DATA_MISSING, 'FEE:SHIPPING'),
  issue(ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD, 'CARGO_ITEM:X:INV1'),
  issue(ProfitIssueCode.AMBIGUOUS_RECORD_MATCH),
  issue(ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE),
];

describe('issuesForView', () => {
  it('keeps every issue in the estimate view, invoices or not', () => {
    const issues = [...CARGO_ISSUES, ...NON_CARGO_ISSUES];
    expect(
      issuesForView(ProfitStatementView.ESTIMATE, issues, [OUTBOUND_INVOICE, RETURN_INVOICE]),
    ).toEqual(issues);
  });

  it('keeps every issue in the best-known view without a cargo invoice', () => {
    const issues = [...CARGO_ISSUES, ...NON_CARGO_ISSUES];
    const estimates = [
      makeLine({ type: ProfitLineType.SALE, gross: '120' }),
      makeLine({ type: ProfitLineType.RETURN_SHIPPING, gross: '0' }),
    ];
    expect(issuesForView(ProfitStatementView.BEST_KNOWN, issues, estimates)).toEqual(issues);
  });

  it('lets an outbound invoice drop only the outbound causes', () => {
    expect(issuesForView(ProfitStatementView.BEST_KNOWN, CARGO_ISSUES, [OUTBOUND_INVOICE])).toEqual(
      [RETURN_UNKNOWN_DESI, RETURN_NO_TARIFF],
    );
  });

  it('lets a return invoice drop only the return causes', () => {
    expect(issuesForView(ProfitStatementView.BEST_KNOWN, CARGO_ISSUES, [RETURN_INVOICE])).toEqual([
      CARRIER,
      OUTBOUND_OVERFLOW,
      OUTBOUND_NO_TARIFF,
      OUTBOUND_NO_DETAIL,
    ]);
  });

  it('never drops a cause the cargo does not cause', () => {
    expect(
      issuesForView(
        ProfitStatementView.BEST_KNOWN,
        [...CARGO_ISSUES, ...NON_CARGO_ISSUES],
        [OUTBOUND_INVOICE, RETURN_INVOICE],
      ),
    ).toEqual(NON_CARGO_ISSUES);
  });

  it('does not count an actual shipping line that is not a cargo invoice', () => {
    // A payment order confirms a seller-cargo shipping estimate as an ACTUAL marketplace
    // record; it is not the carrier's bill, so the shipping causes stay.
    const confirmed = makeLine({
      type: ProfitLineType.SHIPPING,
      gross: '50',
      certainty: ProfitLineCertainty.ACTUAL,
      source: ProfitLineSource.MARKETPLACE_RECORD,
    });
    expect(issuesForView(ProfitStatementView.BEST_KNOWN, CARGO_ISSUES, [confirmed])).toEqual(
      CARGO_ISSUES,
    );
  });
});
