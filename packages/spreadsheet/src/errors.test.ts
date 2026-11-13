import { describe, expect, it } from 'vitest';

import {
  SPREADSHEET_FILE_ERROR_CODES,
  isSpreadsheetFileErrorCode,
  type SpreadsheetFileErrorCode,
} from './errors';

// A Record keyed by the code type: the compiler rejects a missing or an extra key,
// so this literal and the type cannot drift apart.
const ALL: Record<SpreadsheetFileErrorCode, true> = {
  NOT_XLSX: true,
  CORRUPT_FILE: true,
  SHEET_NOT_FOUND: true,
  ROW_CAP_EXCEEDED: true,
  COL_CAP_EXCEEDED: true,
  PAYLOAD_TOO_LARGE: true,
  UNSAFE_CONTENT: true,
  ENGINE_BUSY: true,
  MALFORMED_SHEET: true,
  UNSUPPORTED_ENCODING: true,
  ROW_NOT_FOUND: true,
  ROW_ANCHOR_MISMATCH: true,
};

describe('SPREADSHEET_FILE_ERROR_CODES', () => {
  it('lists every error code once', () => {
    expect(new Set(SPREADSHEET_FILE_ERROR_CODES).size).toBe(SPREADSHEET_FILE_ERROR_CODES.length);
    expect([...SPREADSHEET_FILE_ERROR_CODES].sort()).toEqual(Object.keys(ALL).sort());
    for (const code of SPREADSHEET_FILE_ERROR_CODES) {
      expect(isSpreadsheetFileErrorCode(code)).toBe(true);
    }
    expect(isSpreadsheetFileErrorCode('NOPE')).toBe(false);
  });
});
