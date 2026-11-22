import { ProfitIssueCode, ProfitStatus } from '@pazarsync/db/enums';
import type { ProfitIssue } from '@pazarsync/profit';
import { describe, expect, it } from 'vitest';

import { profitBlockers, storedProfitBlockers } from '@/lib/profit-blockers';

const ITEM_A = '00000000-0000-4000-8000-00000000000a';
const ITEM_B = '00000000-0000-4000-8000-00000000000b';

function issue(code: ProfitIssueCode, detail: string | null, orderItemId: string | null = null) {
  const value: ProfitIssue = { code, orderItemId, detail };
  return value;
}

describe('profitBlockers', () => {
  it('returns the blocking issues of a not-computable view as code + detail', () => {
    const blockers = profitBlockers({
      status: ProfitStatus.NOT_COMPUTABLE,
      issues: [issue(ProfitIssueCode.CARRIER_NOT_RECOGNIZED, 'Alternative Delivery')],
    });
    expect(blockers).toEqual([{ code: 'CARRIER_NOT_RECOGNIZED', detail: 'Alternative Delivery' }]);
  });

  it('leaves out warning codes, which do not block', () => {
    const blockers = profitBlockers({
      status: ProfitStatus.NOT_COMPUTABLE,
      issues: [
        issue(ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE, null),
        issue(ProfitIssueCode.AMBIGUOUS_RECORD_MATCH, 'rec-1'),
        issue(ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD, 'Sale'),
        issue(ProfitIssueCode.MISSING_COST, null, ITEM_A),
      ],
    });
    expect(blockers).toEqual([{ code: 'MISSING_COST', detail: null }]);
  });

  it('collapses the same code + detail named on several items into one blocker', () => {
    const blockers = profitBlockers({
      status: ProfitStatus.NOT_COMPUTABLE,
      issues: [
        issue(ProfitIssueCode.MISSING_COST, null, ITEM_A),
        issue(ProfitIssueCode.MISSING_COST, null, ITEM_B),
        issue(ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE, 'UNKNOWN_DESI'),
        issue(ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE, 'RETURN_UNKNOWN_DESI'),
        issue(ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE, 'UNKNOWN_DESI'),
      ],
    });
    expect(blockers).toEqual([
      { code: 'MISSING_COST', detail: null },
      { code: 'SHIPPING_ESTIMATE_UNAVAILABLE', detail: 'RETURN_UNKNOWN_DESI' },
      { code: 'SHIPPING_ESTIMATE_UNAVAILABLE', detail: 'UNKNOWN_DESI' },
    ]);
  });

  it('orders by the enum order of the code, then by detail with null first', () => {
    const issues = [
      issue(ProfitIssueCode.REFERENCE_DATA_MISSING, 'FEE:PLATFORM_SERVICE'),
      issue(ProfitIssueCode.CARRIER_NOT_RECOGNIZED, 'Kargo X'),
      issue(ProfitIssueCode.MISSING_COMMISSION_RATE, 'NO_ATTRIBUTES', ITEM_A),
      issue(ProfitIssueCode.MISSING_COMMISSION_RATE, null, ITEM_B),
      issue(ProfitIssueCode.MISSING_COST, null, ITEM_A),
    ];
    const forward = profitBlockers({ status: ProfitStatus.NOT_COMPUTABLE, issues });
    const reversed = profitBlockers({
      status: ProfitStatus.NOT_COMPUTABLE,
      issues: [...issues].reverse(),
    });

    const codeOrder: readonly string[] = Object.values(ProfitIssueCode);
    const codes = forward.map((blocker) => codeOrder.indexOf(blocker.code));
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
    expect(
      forward.filter((blocker) => blocker.code === ProfitIssueCode.MISSING_COMMISSION_RATE),
    ).toEqual([
      { code: 'MISSING_COMMISSION_RATE', detail: null },
      { code: 'MISSING_COMMISSION_RATE', detail: 'NO_ATTRIBUTES' },
    ]);
    // The input order does not change the result.
    expect(reversed).toEqual(forward);
  });

  it.each([
    ProfitStatus.ESTIMATED,
    ProfitStatus.PARTIALLY_SETTLED,
    ProfitStatus.SETTLED,
    ProfitStatus.EXCLUDED,
    ProfitStatus.CANCELLED,
  ])('returns no blockers for a %s view, even with a blocking issue on it', (status) => {
    const blockers = profitBlockers({
      status,
      issues: [issue(ProfitIssueCode.CARRIER_NOT_RECOGNIZED, 'Alternative Delivery')],
    });
    expect(blockers).toEqual([]);
  });

  it('fills blockers for NOT_COMPUTABLE alone among every profit status', () => {
    for (const status of Object.values(ProfitStatus)) {
      const blockers = profitBlockers({
        status,
        issues: [issue(ProfitIssueCode.MISSING_COST, null, ITEM_A)],
      });
      expect(blockers.length > 0).toBe(status === ProfitStatus.NOT_COMPUTABLE);
    }
  });

  it('returns no blockers for a not-computable view with no blocking issue', () => {
    expect(profitBlockers({ status: ProfitStatus.NOT_COMPUTABLE, issues: [] })).toEqual([]);
  });
});

describe('storedProfitBlockers', () => {
  it('parses the stored issues of a not-computable row', () => {
    const blockers = storedProfitBlockers({
      status: ProfitStatus.NOT_COMPUTABLE,
      issues: [
        { code: 'CARRIER_NOT_RECOGNIZED', orderItemId: null, detail: 'Alternative Delivery' },
        { code: 'SELLER_CARGO_AGREEMENT_ESTIMATE', orderItemId: null, detail: null },
      ],
    });
    expect(blockers).toEqual([{ code: 'CARRIER_NOT_RECOGNIZED', detail: 'Alternative Delivery' }]);
  });

  it('throws on a corrupt issues value of a not-computable row', () => {
    expect(() =>
      storedProfitBlockers({
        status: ProfitStatus.NOT_COMPUTABLE,
        issues: [{ code: 'NOT_A_REAL_CODE', orderItemId: null, detail: null }],
      }),
    ).toThrow();
    expect(() =>
      storedProfitBlockers({ status: ProfitStatus.NOT_COMPUTABLE, issues: { broken: true } }),
    ).toThrow();
  });

  it('does not parse the issues of any other status', () => {
    expect(
      storedProfitBlockers({
        status: ProfitStatus.ESTIMATED,
        issues: [{ code: 'NOT_A_REAL_CODE', orderItemId: null, detail: null }],
      }),
    ).toEqual([]);
  });
});
