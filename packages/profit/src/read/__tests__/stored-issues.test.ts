import { ProfitIssueCode } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { InvalidStoredProfitDataError } from '../../persistence/errors';
import { parseStoredIssues } from '../stored-issues';

describe('parseStoredIssues', () => {
  it('parses the persisted issue list', () => {
    const issues = parseStoredIssues([
      { code: 'MISSING_COST', orderItemId: 'item-1', detail: 'no cost on the order day' },
      { code: 'UNMAPPED_MARKETPLACE_RECORD', orderItemId: null, detail: null },
    ]);

    expect(issues).toEqual([
      {
        code: ProfitIssueCode.MISSING_COST,
        orderItemId: 'item-1',
        detail: 'no cost on the order day',
      },
      { code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD, orderItemId: null, detail: null },
    ]);
  });

  it('rejects an unknown issue code', () => {
    expect(() =>
      parseStoredIssues([{ code: 'NOT_A_REAL_CODE', orderItemId: null, detail: null }]),
    ).toThrow(InvalidStoredProfitDataError);
  });
});
