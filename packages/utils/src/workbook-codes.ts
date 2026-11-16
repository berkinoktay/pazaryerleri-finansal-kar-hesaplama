/**
 * The codes a refused workbook upload answers on its `file` field. Two lists, one wire: the
 * API answers both through `toUploadError`, and the web maps every code of both to a message
 * (its bucket table is keyed by `WorkbookUploadFileCode`, so a code without a message is a
 * compile error there).
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
] as const;

export type WorkbookFileCode = (typeof WORKBOOK_FILE_CODES)[number];

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

/** Every code an upload's `file` issue can carry. */
export type WorkbookUploadFileCode = WorkbookFileCode | (typeof WORKBOOK_ENGINE_FILE_CODES)[number];

const UPLOAD_FILE_CODES: ReadonlySet<string> = new Set<string>([
  ...WORKBOOK_FILE_CODES,
  ...WORKBOOK_ENGINE_FILE_CODES,
]);

/** True for a code an upload's `file` issue can carry; false for anything else. */
export function isWorkbookUploadFileCode(value: unknown): value is WorkbookUploadFileCode {
  return typeof value === 'string' && UPLOAD_FILE_CODES.has(value);
}
