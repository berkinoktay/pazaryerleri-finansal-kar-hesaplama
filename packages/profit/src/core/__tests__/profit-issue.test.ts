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
  it('the carrier warnings are non-blocking and leave no settlement gap', () => {
    // A not-recognized carrier and a seller-cargo-agreement estimate keep the order's own
    // estimate (a zero or tariff-based shipping line), so they stay visible warnings.
    for (const code of [
      ProfitIssueCode.CARRIER_NOT_RECOGNIZED,
      ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE,
    ]) {
      expect(PROFIT_ISSUE_CATALOG[code]).toEqual({ blocking: false, settlementGap: false });
      expect(isBlockingIssue({ code, orderItemId: null, detail: null })).toBe(false);
    }
  });
  it('isSettlementGapIssue reflects the catalog flag for every code', () => {
    for (const code of Object.values(ProfitIssueCode)) {
      expect(isSettlementGapIssue({ code, orderItemId: null, detail: null })).toBe(
        PROFIT_ISSUE_CATALOG[code].settlementGap,
      );
    }
  });
});
