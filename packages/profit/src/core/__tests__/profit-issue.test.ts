import { ProfitIssueCode } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { isSettlementGapIssue, PROFIT_ISSUE_CATALOG } from '../profit-issue';

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
  it('isSettlementGapIssue reflects the catalog flag for every code', () => {
    for (const code of Object.values(ProfitIssueCode)) {
      expect(isSettlementGapIssue({ code, orderItemId: null, detail: null })).toBe(
        PROFIT_ISSUE_CATALOG[code].settlementGap,
      );
    }
  });
});
