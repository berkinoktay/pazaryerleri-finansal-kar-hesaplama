import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { SpreadsheetFileError, WORKER_LIMIT_REASONS } from '@pazarsync/spreadsheet';
import { syncLog } from '@pazarsync/sync-core';

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

/** Swallows the worker-limit warning so it neither clutters the run nor escapes the spy. */
function silenceWarn(): MockInstance<typeof syncLog.warn> {
  return vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
}

function busy(): SpreadsheetFileError {
  return new SpreadsheetFileError('ENGINE_BUSY', 'Workbook parse queue is full', { cap: 8 });
}

// The two errors the engine's worker host rejects with when a limit kills the parse.
function workerMemoryKill(): SpreadsheetFileError {
  return new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Workbook parse ran out of worker memory', {
    reason: WORKER_LIMIT_REASONS.MEMORY,
    limitMb: 1024,
  });
}

function workerTimeoutKill(): SpreadsheetFileError {
  return new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Workbook parse exceeded the time limit', {
    reason: WORKER_LIMIT_REASONS.TIMEOUT,
    timeoutMs: 30_000,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('logs a worker memory kill once and maps it to a PAYLOAD_TOO_LARGE ValidationError', () => {
    const warnSpy = silenceWarn();
    const thrown = captureThrow(() => mapUploadedFileError(workerMemoryKill()));
    expect(thrown).toBeInstanceOf(ValidationError);
    if (!(thrown instanceof ValidationError)) return;
    expect(thrown.issues).toEqual([{ field: 'file', code: 'PAYLOAD_TOO_LARGE' }]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('spreadsheet.worker-limit', {
      reason: 'worker-memory',
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('logs a worker timeout kill once and maps it to a PAYLOAD_TOO_LARGE file error', () => {
    const warnSpy = silenceWarn();
    const thrown = captureThrow(() => mapUploadedFileError(workerTimeoutKill()));
    expect(thrown).toBeInstanceOf(ValidationError);
    if (!(thrown instanceof ValidationError)) return;
    expect(thrown.issues).toEqual([{ field: 'file', code: 'PAYLOAD_TOO_LARGE' }]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('spreadsheet.worker-limit', {
      reason: 'worker-timeout',
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('keeps a PAYLOAD_TOO_LARGE without a worker reason on the old mapping and logs nothing', () => {
    const warnSpy = silenceWarn();
    const err = new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Workbook is too large', {
      cap: 1024,
    });
    const thrown = captureThrow(() => mapUploadedFileError(err));
    expect(thrown).toBeInstanceOf(ValidationError);
    if (!(thrown instanceof ValidationError)) return;
    expect(thrown.issues).toEqual([{ field: 'file', code: 'PAYLOAD_TOO_LARGE' }]);
    expect(warnSpy).not.toHaveBeenCalled();
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

  it('logs a worker memory kill once and maps it to ImportBusyError', () => {
    const warnSpy = silenceWarn();
    const thrown = captureThrow(() => mapStoredFileError(workerMemoryKill(), STORED_FILE_MESSAGE));
    expect(thrown).toBeInstanceOf(ImportBusyError);
    if (!(thrown instanceof ImportBusyError)) return;
    expect(thrown.retryAfterSeconds).toBe(IMPORT_BUSY_RETRY_AFTER_SECONDS);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('spreadsheet.worker-limit', {
      reason: 'worker-memory',
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('logs a worker timeout kill once and maps it to ImportBusyError', () => {
    const warnSpy = silenceWarn();
    const thrown = captureThrow(() => mapStoredFileError(workerTimeoutKill(), STORED_FILE_MESSAGE));
    expect(thrown).toBeInstanceOf(ImportBusyError);
    if (!(thrown instanceof ImportBusyError)) return;
    expect(thrown.retryAfterSeconds).toBe(IMPORT_BUSY_RETRY_AFTER_SECONDS);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('spreadsheet.worker-limit', {
      reason: 'worker-timeout',
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('keeps a PAYLOAD_TOO_LARGE without a worker reason on the old mapping and logs nothing', () => {
    const warnSpy = silenceWarn();
    const err = new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Workbook is too large', {
      cap: 1024,
    });
    const thrown = captureThrow(() => mapStoredFileError(err, STORED_FILE_MESSAGE));
    expect(thrown).toBeInstanceOf(ConflictError);
    if (!(thrown instanceof ConflictError)) return;
    expect(thrown.message).toBe(STORED_FILE_MESSAGE);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
