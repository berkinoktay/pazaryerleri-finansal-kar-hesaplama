import { ProfitIssueCode } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { isBlockingIssue, isSettlementGapIssue, PROFIT_ISSUE_CATALOG } from '../profit-issue';

describe('PROFIT_ISSUE_CATALOG', () => {
  it('every settlement gap issue is blocking', () => {
    // A settlement gap must leave the order NOT_COMPUTABLE, so deriveProfitStatus
    // returns at its blocking rule before the reconciliation status is even read.
    for (const code of Object.values(ProfitIssueCode)) {
      if (PROFIT_ISSUE_CATALOG[code].settlementGap) {
        expect(PROFIT_ISSUE_CATALOG[code].blocking).toBe(true);
      }
    }
  });
  it('the seller-cargo-agreement estimate is a non-blocking warning with no settlement gap', () => {
    // A seller-cargo-agreement order keeps its tariff-based (or zero) shipping line, so the
    // issue stays a visible warning.
    expect(PROFIT_ISSUE_CATALOG[ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE]).toEqual({
      blocking: false,
      settlementGap: false,
    });
  });
  it('a not-recognized carrier blocks the profit and leaves the shipping slot a gap', () => {
    // A Trendyol-contract order whose carrier is not recognized gets no shipping line at
    // all, so the order is not computable and the empty slot holds reconciliation back.
    expect(PROFIT_ISSUE_CATALOG[ProfitIssueCode.CARRIER_NOT_RECOGNIZED]).toEqual({
      blocking: true,
      settlementGap: true,
    });
    expect(
      isBlockingIssue({
        code: ProfitIssueCode.CARRIER_NOT_RECOGNIZED,
        orderItemId: null,
        detail: null,
      }),
    ).toBe(true);
  });
  it('missing reference data blocks the profit and is a settlement gap', () => {
    // A missing fee definition can leave a settlement-required slot (commission, shipping)
    // without any line, estimate or actual; the gap keeps reconciliation from reading
    // FULLY_SETTLED once the sale records land.
    expect(PROFIT_ISSUE_CATALOG[ProfitIssueCode.REFERENCE_DATA_MISSING]).toEqual({
      blocking: true,
      settlementGap: true,
    });
  });
  it('maps every issue code', () => {
    expect(Object.keys(PROFIT_ISSUE_CATALOG).sort()).toEqual(
      Object.values(ProfitIssueCode).slice().sort(),
    );
  });
  it('isSettlementGapIssue reflects the catalog flag for every code', () => {
    for (const code of Object.values(ProfitIssueCode)) {
      expect(isSettlementGapIssue({ code, orderItemId: null, detail: null })).toBe(
        PROFIT_ISSUE_CATALOG[code].settlementGap,
      );
    }
  });
});
