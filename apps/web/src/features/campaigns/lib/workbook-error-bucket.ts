import { isWorkbookUploadFileCode, type WorkbookUploadFileCode } from '@pazarsync/utils';

/**
 * The sentence group a refused workbook upload is shown with. Several file codes share one
 * sentence (every unreadable archive reads the same to a seller); `generic` is the sentence of
 * a code this build does not know.
 */
export type WorkbookErrorBucket =
  | 'notReadable'
  | 'empty'
  | 'noPeriod'
  | 'duplicateWeek'
  | 'tooLarge'
  | 'wrongFormat'
  | 'unsupportedPlatform'
  | 'prefilled'
  | 'unsafe'
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
    ROW_CAP_EXCEEDED: 'tooLarge',
    COL_CAP_EXCEEDED: 'tooLarge',
    PAYLOAD_TOO_LARGE: 'tooLarge',
    SHEET_NOT_FOUND: 'wrongFormat',
    WRONG_FILE_FOR_PAGE: 'wrongFormat',
    UNSUPPORTED_PLATFORM_FORMAT: 'unsupportedPlatform',
    PREFILLED_SELECTIONS: 'prefilled',
  };

/** The bucket of a file code; `generic` for a code outside the table (a newer API). */
export function bucketOf(code: string): WorkbookErrorBucket {
  return isWorkbookUploadFileCode(code) ? WORKBOOK_ERROR_BUCKETS[code] : 'generic';
}
