import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitStatus,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine, type MakeLineParams } from '../../__tests__/helpers/make-profit-line';
import { PROFIT_ISSUE_CATALOG, type ProfitIssue } from '../profit-issue';
import { deriveProfitStatus } from '../profit-status';
import { type ProfitLine } from '../profit-line';

const actual = (type: ProfitLineType, extra: Partial<MakeLineParams> = {}): ProfitLine =>
  makeLine({
    type,
    gross: '10',
    certainty: ProfitLineCertainty.ACTUAL,
    source: ProfitLineSource.MARKETPLACE_RECORD,
    ...extra,
  });
const issue = (code: ProfitIssueCode): ProfitIssue => ({ code, orderItemId: null, detail: null });
const status = (
  selectedLines: ProfitLine[],
  issues: ProfitIssue[] = [],
  isCancelled = false,
  isExcluded = false,
): ProfitStatus => deriveProfitStatus({ selectedLines, issues, isCancelled, isExcluded });
const sellerCost = makeLine({
  type: ProfitLineType.COST_COGS,
  gross: '60',
  certainty: ProfitLineCertainty.ACTUAL,
  source: ProfitLineSource.SELLER_INPUT,
});

describe('deriveProfitStatus', () => {
  it('covers every issue code in the issue catalog', () => {
    expect(Object.keys(PROFIT_ISSUE_CATALOG).sort()).toEqual(Object.values(ProfitIssueCode).sort());
  });
  it('excluded wins over everything, cancelled wins over blocking issues', () => {
    expect(status([], [issue(ProfitIssueCode.MISSING_COST)], true, true)).toBe(
      ProfitStatus.EXCLUDED,
    );
    expect(status([], [issue(ProfitIssueCode.MISSING_COST)], true, false)).toBe(
      ProfitStatus.CANCELLED,
    );
  });
  it('a blocking issue makes the order not computable', () => {
    expect(status([sellerCost], [issue(ProfitIssueCode.MISSING_FX_RATE)])).toBe(
      ProfitStatus.NOT_COMPUTABLE,
    );
  });
  it('an unmapped record is a warning, not a block', () => {
    expect(status([sellerCost], [issue(ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD)])).toBe(
      ProfitStatus.ESTIMATED,
    );
  });
  it('estimates plus seller cost are ESTIMATED', () => {
    expect(status([makeLine({ type: ProfitLineType.SALE, gross: '120' }), sellerCost])).toBe(
      ProfitStatus.ESTIMATED,
    );
  });
  it('one marketplace actual with a pending required estimate is PARTIALLY_SETTLED', () => {
    expect(
      status([
        actual(ProfitLineType.COMMISSION),
        makeLine({ type: ProfitLineType.SHIPPING, gross: '6' }),
      ]),
    ).toBe(ProfitStatus.PARTIALLY_SETTLED);
  });
  it('all required types actual is SETTLED', () => {
    expect(
      status([
        actual(ProfitLineType.SALE),
        actual(ProfitLineType.COMMISSION),
        actual(ProfitLineType.SHIPPING, { source: ProfitLineSource.CARGO_INVOICE }),
        actual(ProfitLineType.SERVICE_FEE, { level: ProfitLineLevel.PARCEL, orderItemId: null }),
        actual(ProfitLineType.STOPPAGE),
        sellerCost,
      ]),
    ).toBe(ProfitStatus.SETTLED);
  });
});
