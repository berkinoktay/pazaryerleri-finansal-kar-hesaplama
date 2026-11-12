export const SPREADSHEET_FILE_ERROR_CODES = [
  'NOT_XLSX',
  'CORRUPT_FILE',
  'SHEET_NOT_FOUND',
  'ROW_CAP_EXCEEDED',
  'COL_CAP_EXCEEDED',
  'PAYLOAD_TOO_LARGE',
  'UNSAFE_CONTENT',
  // Not about the file: the parse queue is full; the caller may retry later.
  'ENGINE_BUSY',
] as const;

export type SpreadsheetFileErrorCode = (typeof SPREADSHEET_FILE_ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(SPREADSHEET_FILE_ERROR_CODES);

export function isSpreadsheetFileErrorCode(value: unknown): value is SpreadsheetFileErrorCode {
  return typeof value === 'string' && ERROR_CODE_SET.has(value);
}

/** Neutral file-level error; decoupled from api/domain. Consumer route maps it to its own RFC 7807 response. */
export class SpreadsheetFileError extends Error {
  readonly code: SpreadsheetFileErrorCode;
  readonly meta: Readonly<Record<string, unknown>>;
  constructor(code: SpreadsheetFileErrorCode, message: string, meta: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SpreadsheetFileError';
    this.code = code;
    this.meta = meta;
  }
}
