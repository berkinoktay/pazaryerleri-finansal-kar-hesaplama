import { describe, expect, it } from 'vitest';

import { WORKBOOK_ENGINE_FILE_CODES, WORKBOOK_FILE_CODES } from '@pazarsync/utils';

import {
  bucketOf,
  WORKBOOK_ERROR_BUCKETS,
  type WorkbookErrorBucket,
} from '@/features/campaigns/lib/workbook-error-bucket';

describe('bucketOf', () => {
  it.each<[string, WorkbookErrorBucket]>([
    ['CORRUPT_FILE', 'notReadable'],
    ['EMPTY_FILE', 'empty'],
    ['NO_PERIOD', 'noPeriod'],
    ['DUPLICATE_WEEK', 'duplicateWeek'],
    ['ROW_CAP_EXCEEDED', 'tooLarge'],
    ['WRONG_FILE_FOR_PAGE', 'wrongFormat'],
    ['UNSUPPORTED_PLATFORM_FORMAT', 'unsupportedPlatform'],
    ['PREFILLED_SELECTIONS', 'prefilled'],
    ['UNSAFE_CONTENT', 'unsafe'],
    ['SOME_FUTURE_CODE', 'generic'],
  ])('puts %s in the %s bucket', (code, bucket) => {
    expect(bucketOf(code)).toBe(bucket);
  });
});

describe('WORKBOOK_ERROR_BUCKETS', () => {
  it('has one entry for every file code of the pipeline and of the engine, and no other', () => {
    expect(Object.keys(WORKBOOK_ERROR_BUCKETS).sort()).toEqual(
      [...new Set<string>([...WORKBOOK_FILE_CODES, ...WORKBOOK_ENGINE_FILE_CODES])].sort(),
    );
  });
});
