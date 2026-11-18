/**
 * The codes a refused workbook upload answers on its `file` field. Three lists, one wire: the
 * API answers the pipeline's and the engine's through `toUploadError` and the form's through
 * request validation, and the web maps every code of all three to a message (its bucket table
 * is keyed by `WorkbookUploadFileCode`, so a code without a message is a compile error there).
 */

/** Why an uploaded workbook is refused, beyond what the engine itself refuses. */
export const WORKBOOK_FILE_CODES = [
  'UNSUPPORTED_PLATFORM_FORMAT',
  'SHEET_NOT_FOUND',
  'WRONG_FILE_FOR_PAGE',
  'EMPTY_FILE',
  'NO_PERIOD',
  'DUPLICATE_WEEK',
  'PREFILLED_SELECTIONS',
  // An upload whose sheet has no column the export could write the seller's selections into.
  'NO_WRITEBACK_COLUMN',
] as const;

export type WorkbookFileCode = (typeof WORKBOOK_FILE_CODES)[number];

/**
 * The `meta.limit` of a `PAYLOAD_TOO_LARGE` file issue that is about filled rows, not bytes
 * (the content weight of the sheets). A `PAYLOAD_TOO_LARGE` without it is a size refusal.
 */
export const WORKBOOK_FILE_LIMITS = {
  ROWS: 'rows',
} as const;

/** The `meta.limit` of a `409 UPLOAD_QUOTA_EXCEEDED`: which of the two upload quotas was hit. */
export const UPLOAD_QUOTA_LIMITS = {
  LISTS: 'lists',
  BYTES: 'bytes',
} as const;

export type UploadQuotaLimit = (typeof UPLOAD_QUOTA_LIMITS)[keyof typeof UPLOAD_QUOTA_LIMITS];

/**
 * The spreadsheet engine's refusals a `file` issue can carry: every code of
 * `SPREADSHEET_FILE_ERROR_CODES` (`@pazarsync/spreadsheet`) except `ENGINE_BUSY`, which is a
 * 503, never a file issue. This package cannot import the engine, so an API unit test pins
 * the two lists equal.
 */
export const WORKBOOK_ENGINE_FILE_CODES = [
  'NOT_XLSX',
  'CORRUPT_FILE',
  'SHEET_NOT_FOUND',
  'ROW_CAP_EXCEEDED',
  'COL_CAP_EXCEEDED',
  'PAYLOAD_TOO_LARGE',
  'UNSAFE_CONTENT',
  'MALFORMED_SHEET',
  'UNSUPPORTED_ENCODING',
  'ROW_NOT_FOUND',
  'ROW_ANCHOR_MISMATCH',
] as const;

/**
 * The import forms' own refusals of the `file` part, answered by request validation before
 * the pipeline reads anything: no `file` part, or one that is not a file.
 */
export const WORKBOOK_FORM_FILE_CODES = ['FILE_REQUIRED'] as const;

export type WorkbookFormFileCode = (typeof WORKBOOK_FORM_FILE_CODES)[number];

/** Every code an upload's `file` issue can carry. */
export type WorkbookUploadFileCode =
  | WorkbookFileCode
  | (typeof WORKBOOK_ENGINE_FILE_CODES)[number]
  | WorkbookFormFileCode;

const UPLOAD_FILE_CODES: ReadonlySet<string> = new Set<string>([
  ...WORKBOOK_FILE_CODES,
  ...WORKBOOK_ENGINE_FILE_CODES,
  ...WORKBOOK_FORM_FILE_CODES,
]);

/** True for a code an upload's `file` issue can carry; false for anything else. */
export function isWorkbookUploadFileCode(value: unknown): value is WorkbookUploadFileCode {
  return typeof value === 'string' && UPLOAD_FILE_CODES.has(value);
}
