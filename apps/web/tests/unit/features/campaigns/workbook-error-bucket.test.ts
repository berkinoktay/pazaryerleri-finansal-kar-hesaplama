import { describe, expect, it } from 'vitest';

import { WORKBOOK_ENGINE_FILE_CODES, WORKBOOK_FILE_CODES } from '@pazarsync/utils';

import {
  bucketOf,
  refusalOf,
  WORKBOOK_ERROR_BUCKETS,
  type WorkbookErrorBucket,
  type WorkbookRefusal,
} from '@/features/campaigns/lib/workbook-error-bucket';

const MAX_ROWS = 5000;
const MAX_COLS = 64;

describe('bucketOf', () => {
  it.each<[string, WorkbookErrorBucket]>([
    ['CORRUPT_FILE', 'notReadable'],
    ['EMPTY_FILE', 'empty'],
    ['NO_PERIOD', 'noPeriod'],
    ['DUPLICATE_WEEK', 'duplicateWeek'],
    ['ROW_CAP_EXCEEDED', 'tooManyRows'],
    ['COL_CAP_EXCEEDED', 'tooManyColumns'],
    ['PAYLOAD_TOO_LARGE', 'tooLarge'],
    ['WRONG_FILE_FOR_PAGE', 'wrongFormat'],
    ['UNSUPPORTED_PLATFORM_FORMAT', 'unsupportedPlatform'],
    ['PREFILLED_SELECTIONS', 'prefilled'],
    ['UNSAFE_CONTENT', 'unsafe'],
    ['NO_WRITEBACK_COLUMN', 'noWriteColumn'],
    ['SOME_FUTURE_CODE', 'generic'],
  ])('puts %s in the %s bucket', (code, bucket) => {
    expect(bucketOf(code)).toBe(bucket);
  });
});

describe('refusalOf', () => {
  it.each<[string, string, Record<string, unknown>, WorkbookRefusal]>([
    [
      'a row cap with its limit',
      'ROW_CAP_EXCEEDED',
      { maxRows: MAX_ROWS },
      { bucket: 'tooManyRows', maxRows: MAX_ROWS },
    ],
    [
      'a column cap with its limit',
      'COL_CAP_EXCEEDED',
      { maxCols: MAX_COLS },
      { bucket: 'tooManyColumns', maxCols: MAX_COLS },
    ],
    [
      'a content refusal about rows with its limit',
      'PAYLOAD_TOO_LARGE',
      { limit: 'rows', maxRows: MAX_ROWS },
      { bucket: 'tooMuchContent', maxRows: MAX_ROWS },
    ],
    ['a size refusal', 'PAYLOAD_TOO_LARGE', {}, { bucket: 'tooLarge' }],
    ['a row cap without meta', 'ROW_CAP_EXCEEDED', {}, { bucket: 'tooLarge' }],
    [
      'a row cap whose limit is a string',
      'ROW_CAP_EXCEEDED',
      { maxRows: String(MAX_ROWS) },
      { bucket: 'tooLarge' },
    ],
    ['a row cap whose limit is 0', 'ROW_CAP_EXCEEDED', { maxRows: 0 }, { bucket: 'tooLarge' }],
    [
      'a row cap whose limit is NaN',
      'ROW_CAP_EXCEEDED',
      { maxRows: Number.NaN },
      { bucket: 'tooLarge' },
    ],
    ['a column cap without meta', 'COL_CAP_EXCEEDED', {}, { bucket: 'tooLarge' }],
    [
      'a content refusal about rows without a limit',
      'PAYLOAD_TOO_LARGE',
      { limit: 'rows' },
      { bucket: 'tooLarge' },
    ],
    ['a code outside the limits', 'EMPTY_FILE', { maxRows: MAX_ROWS }, { bucket: 'empty' }],
    ['a code this build does not know', 'SOME_FUTURE_CODE', {}, { bucket: 'generic' }],
  ])('resolves %s', (_label, code, meta, expected) => {
    expect(refusalOf({ code, meta })).toEqual(expected);
  });
});

describe('WORKBOOK_ERROR_BUCKETS', () => {
  it('has one entry for every file code of the pipeline and of the engine, and no other', () => {
    expect(Object.keys(WORKBOOK_ERROR_BUCKETS).sort()).toEqual(
      [...new Set<string>([...WORKBOOK_FILE_CODES, ...WORKBOOK_ENGINE_FILE_CODES])].sort(),
    );
  });
});
