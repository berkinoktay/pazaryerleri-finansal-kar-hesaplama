import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { type ProfitIssue } from '../../core/profit-issue';
import { makeLine } from '../../__tests__/helpers/make-profit-line';
import { visibleProfitIssues } from '../visible-profit-issues';

const CARRIER_NOT_RECOGNIZED: ProfitIssue = {
  code: ProfitIssueCode.CARRIER_NOT_RECOGNIZED,
  orderItemId: null,
  detail: 'Alternative Delivery',
};
const SELLER_CARGO_AGREEMENT_ESTIMATE: ProfitIssue = {
  code: ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE,
  orderItemId: null,
  detail: null,
};
const UNMAPPED_MARKETPLACE_RECORD: ProfitIssue = {
  code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
  orderItemId: null,
  detail: 'record-1',
};

const SALE = makeLine({ type: ProfitLineType.SALE, gross: '140.00', vat: '12.73' });
const ESTIMATED_SHIPPING = makeLine({ type: ProfitLineType.SHIPPING, gross: '0.00' });
const INVOICED_SHIPPING = makeLine({
  type: ProfitLineType.SHIPPING,
  gross: '42.99',
  vat: '7.17',
  certainty: ProfitLineCertainty.ACTUAL,
  source: ProfitLineSource.CARGO_INVOICE,
});
const ESTIMATED_RETURN_SHIPPING = makeLine({
  type: ProfitLineType.RETURN_SHIPPING,
  gross: '42.99',
  vat: '7.17',
});

describe('visibleProfitIssues', () => {
  it('keeps a not-recognized carrier while the shipping is still an estimate', () => {
    expect(visibleProfitIssues([CARRIER_NOT_RECOGNIZED], [SALE, ESTIMATED_SHIPPING])).toEqual([
      CARRIER_NOT_RECOGNIZED,
    ]);
  });

  it('drops a not-recognized carrier once a cargo invoice replaced the shipping estimate', () => {
    expect(visibleProfitIssues([CARRIER_NOT_RECOGNIZED], [SALE, INVOICED_SHIPPING])).toEqual([]);
  });

  it('keeps a seller-cargo-agreement estimate while the shipping is still an estimate', () => {
    expect(
      visibleProfitIssues([SELLER_CARGO_AGREEMENT_ESTIMATE], [SALE, ESTIMATED_SHIPPING]),
    ).toEqual([SELLER_CARGO_AGREEMENT_ESTIMATE]);
  });

  it('drops a seller-cargo-agreement estimate once no shipping line is an estimate', () => {
    expect(
      visibleProfitIssues([SELLER_CARGO_AGREEMENT_ESTIMATE], [SALE, INVOICED_SHIPPING]),
    ).toEqual([]);
  });

  it('keeps a seller-cargo-agreement estimate when the statement has no shipping line', () => {
    // An unknown desi writes no shipping line at all: nothing replaced the estimate.
    expect(visibleProfitIssues([SELLER_CARGO_AGREEMENT_ESTIMATE], [SALE])).toEqual([
      SELLER_CARGO_AGREEMENT_ESTIMATE,
    ]);
  });

  it('keeps a seller-cargo-agreement estimate while the return shipping is an estimate', () => {
    expect(
      visibleProfitIssues(
        [SELLER_CARGO_AGREEMENT_ESTIMATE],
        [SALE, INVOICED_SHIPPING, ESTIMATED_RETURN_SHIPPING],
      ),
    ).toEqual([SELLER_CARGO_AGREEMENT_ESTIMATE]);
  });

  it('keeps every other issue as it is', () => {
    const issues = [CARRIER_NOT_RECOGNIZED, UNMAPPED_MARKETPLACE_RECORD];
    expect(visibleProfitIssues(issues, [SALE, INVOICED_SHIPPING])).toEqual([
      UNMAPPED_MARKETPLACE_RECORD,
    ]);
    expect(visibleProfitIssues([UNMAPPED_MARKETPLACE_RECORD], [SALE, ESTIMATED_SHIPPING])).toEqual([
      UNMAPPED_MARKETPLACE_RECORD,
    ]);
  });
});
