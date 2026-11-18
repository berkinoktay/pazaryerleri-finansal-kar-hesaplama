import {
  isWorkbookUploadFileCode,
  WORKBOOK_FILE_LIMITS,
  type WorkbookUploadFileCode,
} from '@pazarsync/utils';

import { isPositiveLimit, PAYLOAD_TOO_LARGE } from './upload-error';

/**
 * The sentence group a refused workbook upload is shown with. Several file codes share one
 * sentence (every unreadable archive reads the same to a seller); `generic` is the sentence of
 * a code this build does not know. `tooManyRows`, `tooManyColumns` and `tooMuchContent` name
 * a limit from the issue's meta, so they are only shown through `refusalOf`.
 */
export type WorkbookErrorBucket =
  | 'notReadable'
  | 'empty'
  | 'noPeriod'
  | 'duplicateWeek'
  | 'tooLarge'
  | 'tooManyRows'
  | 'tooManyColumns'
  | 'tooMuchContent'
  | 'wrongFormat'
  | 'unsupportedPlatform'
  | 'prefilled'
  | 'unsafe'
  | 'noWriteColumn'
  | 'generic';

/**
 * Every file code an upload can be refused with, mapped to its bucket. Keyed by the API's own
 * code lists (`@pazarsync/utils`), so a new code without a bucket is a compile error here.
 */
export const WORKBOOK_ERROR_BUCKETS: Readonly<Record<WorkbookUploadFileCode, WorkbookErrorBucket>> =
  {
    NOT_XLSX: 'notReadable',
    CORRUPT_FILE: 'notReadable',
    MALFORMED_SHEET: 'notReadable',
    UNSUPPORTED_ENCODING: 'notReadable',
    ROW_NOT_FOUND: 'notReadable',
    ROW_ANCHOR_MISMATCH: 'notReadable',
    UNSAFE_CONTENT: 'unsafe',
    EMPTY_FILE: 'empty',
    NO_PERIOD: 'noPeriod',
    DUPLICATE_WEEK: 'duplicateWeek',
    ROW_CAP_EXCEEDED: 'tooManyRows',
    COL_CAP_EXCEEDED: 'tooManyColumns',
    PAYLOAD_TOO_LARGE: 'tooLarge',
    SHEET_NOT_FOUND: 'wrongFormat',
    WRONG_FILE_FOR_PAGE: 'wrongFormat',
    UNSUPPORTED_PLATFORM_FORMAT: 'unsupportedPlatform',
    PREFILLED_SELECTIONS: 'prefilled',
    NO_WRITEBACK_COLUMN: 'noWriteColumn',
  };

/** The bucket of a file code; `generic` for a code outside the table (a newer API). */
export function bucketOf(code: string): WorkbookErrorBucket {
  return isWorkbookUploadFileCode(code) ? WORKBOOK_ERROR_BUCKETS[code] : 'generic';
}

/** The buckets whose sentence names a limit the API sent in the issue's meta. */
type LimitBucket = 'tooManyRows' | 'tooMuchContent' | 'tooManyColumns';

/**
 * A refused upload resolved to the sentence it is shown with: the bucket, plus the limit a
 * limit bucket names. Every other bucket's sentence takes no argument.
 */
export type WorkbookRefusal =
  | { readonly bucket: 'tooManyRows' | 'tooMuchContent'; readonly maxRows: number }
  | { readonly bucket: 'tooManyColumns'; readonly maxCols: number }
  | { readonly bucket: Exclude<WorkbookErrorBucket, LimitBucket> };

/** What an upload's `file` issue carries: its code and the meta the API sent with it. */
interface RefusedFileIssue {
  readonly code: string;
  readonly meta: Readonly<Record<string, unknown>>;
}

/** The size sentence, for a limit refusal whose meta carries no usable limit. */
const SIZE_REFUSAL: WorkbookRefusal = { bucket: 'tooLarge' };

/** A limit from the meta: a positive finite number, else null. */
function limitOf(value: unknown): number | null {
  return isPositiveLimit(value) ? value : null;
}

/**
 * Resolves a file issue to its sentence. The bucket is `bucketOf(issue.code)`, except that a
 * `PAYLOAD_TOO_LARGE` whose `meta.limit` is `WORKBOOK_FILE_LIMITS.ROWS` is about filled rows
 * (`tooMuchContent`). A row, column or content refusal needs its limit in the meta (`maxRows`
 * or `maxCols`, a positive finite number); without one (an older API) it is shown with the
 * size sentence, never with a number of our own.
 */
export function refusalOf(issue: RefusedFileIssue): WorkbookRefusal {
  const bucket =
    issue.code === PAYLOAD_TOO_LARGE && issue.meta['limit'] === WORKBOOK_FILE_LIMITS.ROWS
      ? 'tooMuchContent'
      : bucketOf(issue.code);

  switch (bucket) {
    case 'tooManyRows':
    case 'tooMuchContent': {
      const maxRows = limitOf(issue.meta['maxRows']);
      return maxRows === null ? SIZE_REFUSAL : { bucket, maxRows };
    }
    case 'tooManyColumns': {
      const maxCols = limitOf(issue.meta['maxCols']);
      return maxCols === null ? SIZE_REFUSAL : { bucket, maxCols };
    }
    default:
      return { bucket };
  }
}
