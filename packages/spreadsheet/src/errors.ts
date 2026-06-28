export type SpreadsheetFileErrorCode =
  | 'NOT_XLSX'
  | 'CORRUPT_FILE'
  | 'MISSING_REQUIRED_HEADERS'
  | 'AMBIGUOUS_HEADERS'
  | 'SHEET_NOT_FOUND'
  | 'ROW_CAP_EXCEEDED'
  | 'COL_CAP_EXCEEDED'
  | 'PAYLOAD_TOO_LARGE';

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
