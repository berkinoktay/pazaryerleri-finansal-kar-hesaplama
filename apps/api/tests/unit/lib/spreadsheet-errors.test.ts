import { describe, expect, it } from 'vitest';

import { SpreadsheetFileError } from '@pazarsync/spreadsheet';

import { IMPORT_BUSY_RETRY_AFTER_SECONDS } from '@/config/workbook-limits';
import { ConflictError, ImportBusyError, ValidationError } from '@/lib/errors';
import { mapStoredFileError, mapUploadedFileError } from '@/lib/spreadsheet-errors';

const STORED_FILE_MESSAGE = 'Stored test file could not be read';

function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the function to throw');
}

function busy(): SpreadsheetFileError {
  return new SpreadsheetFileError('ENGINE_BUSY', 'Workbook parse queue is full', { cap: 8 });
}

describe('mapUploadedFileError', () => {
  it('maps ENGINE_BUSY to ImportBusyError with the import Retry-After', () => {
    const thrown = captureThrow(() => mapUploadedFileError(busy()));
    expect(thrown).toBeInstanceOf(ImportBusyError);
    if (!(thrown instanceof ImportBusyError)) return;
    expect(thrown.retryAfterSeconds).toBe(IMPORT_BUSY_RETRY_AFTER_SECONDS);
  });

  it('maps any other file error to a field-level ValidationError without its meta', () => {
    const err = new SpreadsheetFileError('ROW_CAP_EXCEEDED', 'Too many rows', {
      entry: 'xl/worksheets/sheet1.xml',
      rowCap: 5000,
    });
    const thrown = captureThrow(() => mapUploadedFileError(err));
    expect(thrown).toBeInstanceOf(ValidationError);
    if (!(thrown instanceof ValidationError)) return;
    expect(thrown.issues).toEqual([{ field: 'file', code: 'ROW_CAP_EXCEEDED' }]);
  });

  it('rethrows an error that is not a file error untouched', () => {
    const err = new Error('boom');
    expect(captureThrow(() => mapUploadedFileError(err))).toBe(err);
  });
});

describe('mapStoredFileError', () => {
  it('maps ENGINE_BUSY to ImportBusyError with the import Retry-After', () => {
    const thrown = captureThrow(() => mapStoredFileError(busy(), STORED_FILE_MESSAGE));
    expect(thrown).toBeInstanceOf(ImportBusyError);
    if (!(thrown instanceof ImportBusyError)) return;
    expect(thrown.retryAfterSeconds).toBe(IMPORT_BUSY_RETRY_AFTER_SECONDS);
  });

  it('maps any other file error to a ConflictError carrying the given message', () => {
    const err = new SpreadsheetFileError('CORRUPT_FILE', 'Cannot read workbook', {
      cause: 'detail',
    });
    const thrown = captureThrow(() => mapStoredFileError(err, STORED_FILE_MESSAGE));
    expect(thrown).toBeInstanceOf(ConflictError);
    if (!(thrown instanceof ConflictError)) return;
    expect(thrown.message).toBe(STORED_FILE_MESSAGE);
  });

  it('rethrows an error that is not a file error untouched', () => {
    const err = new Error('boom');
    expect(captureThrow(() => mapStoredFileError(err, STORED_FILE_MESSAGE))).toBe(err);
  });
});
