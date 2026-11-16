import { describe, expect, it } from 'vitest';

import {
  isWorkbookUploadFileCode,
  WORKBOOK_ENGINE_FILE_CODES,
  WORKBOOK_FILE_CODES,
} from '../workbook-codes';

// The file codes an upload's `file` issue can carry: the pipeline's own and the engine's.
// The web maps every one of them to a message, so the guard must know them all and nothing
// else (ENGINE_BUSY is a 503, never a file issue).

describe('isWorkbookUploadFileCode', () => {
  it.each([...WORKBOOK_FILE_CODES])('knows the pipeline code %s', (code) => {
    expect(isWorkbookUploadFileCode(code)).toBe(true);
  });

  it.each([...WORKBOOK_ENGINE_FILE_CODES])('knows the engine code %s', (code) => {
    expect(isWorkbookUploadFileCode(code)).toBe(true);
  });

  it.each([['ENGINE_BUSY'], ['CONFLICT'], [null], [42]])('refuses %s', (value) => {
    expect(isWorkbookUploadFileCode(value)).toBe(false);
  });
});

describe('the two code lists', () => {
  it('share only SHEET_NOT_FOUND', () => {
    const union = new Set<string>([...WORKBOOK_FILE_CODES, ...WORKBOOK_ENGINE_FILE_CODES]);

    expect(union.size).toBe(WORKBOOK_FILE_CODES.length + WORKBOOK_ENGINE_FILE_CODES.length - 1);
  });
});
