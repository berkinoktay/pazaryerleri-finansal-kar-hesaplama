import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { SpreadsheetFileError, WORKER_LIMIT_REASONS } from '@pazarsync/spreadsheet';
import { syncLog } from '@pazarsync/sync-core';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import {
  ImportBusyError,
  ValidationError,
  WorkbookConflictError,
  type WorkbookConflictReason,
} from '@/lib/errors';
import { problemDetailsForError } from '@/lib/problem-details';
import {
  toStoredFileError,
  toUploadError,
  WorkbookFileRejection,
  WorkbookInvariantError,
} from '@/workbooks/workbook-errors';

const PAGE = WORKBOOK_PAGES.DISCOUNT_LIST;
const UPLOAD = { page: PAGE } as const;
const RECORD_ID = '3f8b6a52-0c1e-4b8f-9d1a-7e2f4c5b6a70';
const STORED = { page: PAGE, recordId: RECORD_ID } as const;

function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the function to throw');
}

function spyInfo(): MockInstance<typeof syncLog.info> {
  return vi.spyOn(syncLog, 'info').mockImplementation(() => undefined);
}

function spyWarn(): MockInstance<typeof syncLog.warn> {
  return vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
}

function busy(): SpreadsheetFileError {
  return new SpreadsheetFileError('ENGINE_BUSY', 'Workbook parse queue is full', { cap: 8 });
}

function workerTimeoutKill(): SpreadsheetFileError {
  return new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Workbook parse exceeded the time limit', {
    reason: WORKER_LIMIT_REASONS.TIMEOUT,
    timeoutMs: 30_000,
  });
}

function workerMemoryKill(): SpreadsheetFileError {
  return new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Workbook parse ran out of worker memory', {
    reason: WORKER_LIMIT_REASONS.MEMORY,
    limitMb: 1024,
  });
}

/** A file over the engine's size cap: PAYLOAD_TOO_LARGE with no worker reason. */
function sizeCapRefusal(): SpreadsheetFileError {
  return new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Workbook is too large', { cap: 1024 });
}

function uploadIssues(err: unknown): unknown {
  const thrown = captureThrow(() => toUploadError(err, {}, UPLOAD));
  if (!(thrown instanceof ValidationError)) {
    throw new Error(`expected a ValidationError, got ${String(thrown)}`);
  }
  return thrown.issues;
}

function storedReason(err: unknown): WorkbookConflictReason {
  const thrown = captureThrow(() => toStoredFileError(err, STORED));
  if (!(thrown instanceof WorkbookConflictError)) {
    throw new Error(`expected a WorkbookConflictError, got ${String(thrown)}`);
  }
  return thrown.reason;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toUploadError', () => {
  it('replaces a rejection code with its legacy code', () => {
    const thrown = captureThrow(() =>
      toUploadError(
        new WorkbookFileRejection('EMPTY_FILE'),
        { EMPTY_FILE: 'EMPTY_DISCOUNT_FILE' },
        UPLOAD,
      ),
    );
    expect(thrown).toBeInstanceOf(ValidationError);
    if (!(thrown instanceof ValidationError)) return;
    expect(thrown.issues).toEqual([{ field: 'file', code: 'EMPTY_DISCOUNT_FILE' }]);
  });

  it('keeps a rejection code without a legacy entry, with its meta', () => {
    const meta = {
      detectedFormatId: 'TRENDYOL:FLASH_PRODUCT_LIST:v1',
      detectedPlatform: 'TRENDYOL',
      detectedPage: 'FLASH_PRODUCT_LIST',
    };
    const thrown = captureThrow(() =>
      toUploadError(
        new WorkbookFileRejection('WRONG_FILE_FOR_PAGE', meta),
        { EMPTY_FILE: 'EMPTY_DISCOUNT_FILE' },
        UPLOAD,
      ),
    );
    expect(thrown).toBeInstanceOf(ValidationError);
    if (!(thrown instanceof ValidationError)) return;
    expect(thrown.issues).toEqual([{ field: 'file', code: 'WRONG_FILE_FOR_PAGE', meta }]);
  });

  it('maps ENGINE_BUSY to a 503 with Retry-After 5', () => {
    const thrown = captureThrow(() => toUploadError(busy(), {}, UPLOAD));
    expect(thrown).toBeInstanceOf(ImportBusyError);
    const { status, headers } = problemDetailsForError(thrown);
    expect(status).toBe(503);
    expect(headers).toEqual({ 'Retry-After': '5' });
  });

  it('maps a worker timeout kill to a 422 PAYLOAD_TOO_LARGE and logs the worker limit', () => {
    spyInfo();
    const warnSpy = spyWarn();
    expect(uploadIssues(workerTimeoutKill())).toEqual([
      { field: 'file', code: 'PAYLOAD_TOO_LARGE' },
    ]);
    expect(warnSpy).toHaveBeenCalledWith('spreadsheet.worker-limit', {
      reason: 'worker-timeout',
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('logs a worker memory kill once and maps it to a 422 PAYLOAD_TOO_LARGE', () => {
    spyInfo();
    const warnSpy = spyWarn();
    expect(uploadIssues(workerMemoryKill())).toEqual([
      { field: 'file', code: 'PAYLOAD_TOO_LARGE' },
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('spreadsheet.worker-limit', {
      reason: 'worker-memory',
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('logs no worker limit for a PAYLOAD_TOO_LARGE without a worker reason', () => {
    spyInfo();
    const warnSpy = spyWarn();
    expect(uploadIssues(sizeCapRefusal())).toEqual([{ field: 'file', code: 'PAYLOAD_TOO_LARGE' }]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('maps MALFORMED_SHEET to a 422 MALFORMED_SHEET without the engine meta', () => {
    spyInfo();
    const err = new SpreadsheetFileError('MALFORMED_SHEET', 'Shared formula over a target', {
      reason: 'shared-formula',
      entry: 'xl/worksheets/sheet1.xml',
    });
    const thrown = captureThrow(() => toUploadError(err, {}, UPLOAD));
    expect(thrown).toBeInstanceOf(ValidationError);
    if (!(thrown instanceof ValidationError)) return;
    expect(thrown.issues).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
    const { status, body } = problemDetailsForError(thrown);
    expect(status).toBe(422);
    expect(JSON.stringify(body)).not.toContain('sheet1.xml');
  });

  it('logs an engine rejection with page, code and reason and nothing else', () => {
    const infoSpy = spyInfo();
    const err = new SpreadsheetFileError('MALFORMED_SHEET', 'Merged range over a target', {
      reason: 'merged-target',
      entry: 'xl/worksheets/sheet1.xml',
      cell: 'B2',
    });
    captureThrow(() => toUploadError(err, {}, UPLOAD));
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith('workbook.upload-rejected', {
      page: PAGE,
      code: 'MALFORMED_SHEET',
      reason: 'merged-target',
    });
  });

  it('logs a null reason when the engine meta carries no string reason', () => {
    const infoSpy = spyInfo();
    captureThrow(() =>
      toUploadError(
        new SpreadsheetFileError('NOT_XLSX', 'Not a workbook', { reason: 7 }),
        {},
        UPLOAD,
      ),
    );
    expect(infoSpy).toHaveBeenCalledWith('workbook.upload-rejected', {
      page: PAGE,
      code: 'NOT_XLSX',
      reason: null,
    });
  });

  it('rethrows anything else untouched', () => {
    const plain = new Error('boom');
    expect(captureThrow(() => toUploadError(plain, {}, UPLOAD))).toBe(plain);
    const invariant = new WorkbookInvariantError('anchor missing');
    expect(captureThrow(() => toUploadError(invariant, {}, UPLOAD))).toBe(invariant);
  });
});

describe('toStoredFileError', () => {
  it('maps ENGINE_BUSY to a 503 with Retry-After 5', () => {
    const thrown = captureThrow(() => toStoredFileError(busy(), STORED));
    expect(thrown).toBeInstanceOf(ImportBusyError);
    const { status, headers } = problemDetailsForError(thrown);
    expect(status).toBe(503);
    expect(headers).toEqual({ 'Retry-After': '5' });
  });

  it('maps ROW_NOT_FOUND and ROW_ANCHOR_MISMATCH to the conflict of the same reason', () => {
    expect(storedReason(new SpreadsheetFileError('ROW_NOT_FOUND', 'Row 9 is missing'))).toBe(
      'ROW_NOT_FOUND',
    );
    expect(
      storedReason(new SpreadsheetFileError('ROW_ANCHOR_MISMATCH', 'Row 9 holds another value')),
    ).toBe('ROW_ANCHOR_MISMATCH');
  });

  it('maps an engine SHEET_NOT_FOUND to STORED_FILE_UNRECOGNIZED', () => {
    expect(storedReason(new SpreadsheetFileError('SHEET_NOT_FOUND', 'Sheet not found'))).toBe(
      'STORED_FILE_UNRECOGNIZED',
    );
  });

  it('maps a worker timeout kill to STORED_FILE_UNREADABLE and logs the worker limit once', () => {
    const warnSpy = spyWarn();
    expect(storedReason(workerTimeoutKill())).toBe('STORED_FILE_UNREADABLE');
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith('spreadsheet.worker-limit', {
      reason: 'worker-timeout',
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(warnSpy).toHaveBeenCalledWith('workbook.stored-file-rejected', {
      page: PAGE,
      recordId: RECORD_ID,
      code: 'PAYLOAD_TOO_LARGE',
      reason: 'worker-timeout',
    });
  });

  it('maps a worker memory kill to STORED_FILE_UNREADABLE and logs the worker limit once', () => {
    const warnSpy = spyWarn();
    expect(storedReason(workerMemoryKill())).toBe('STORED_FILE_UNREADABLE');
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith('spreadsheet.worker-limit', {
      reason: 'worker-memory',
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(warnSpy).toHaveBeenCalledWith('workbook.stored-file-rejected', {
      page: PAGE,
      recordId: RECORD_ID,
      code: 'PAYLOAD_TOO_LARGE',
      reason: 'worker-memory',
    });
  });

  it('logs no worker limit for a PAYLOAD_TOO_LARGE without a worker reason', () => {
    const warnSpy = spyWarn();
    expect(storedReason(sizeCapRefusal())).toBe('STORED_FILE_UNREADABLE');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('workbook.stored-file-rejected', {
      page: PAGE,
      recordId: RECORD_ID,
      code: 'PAYLOAD_TOO_LARGE',
      reason: null,
    });
  });

  it('maps NOT_XLSX to STORED_FILE_UNREADABLE, logs page and record id, and returns no engine code', () => {
    const warnSpy = spyWarn();
    const thrown = captureThrow(() =>
      toStoredFileError(new SpreadsheetFileError('NOT_XLSX', 'Not a workbook'), STORED),
    );
    expect(thrown).toBeInstanceOf(WorkbookConflictError);
    if (!(thrown instanceof WorkbookConflictError)) return;
    expect(thrown.reason).toBe('STORED_FILE_UNREADABLE');
    expect(warnSpy).toHaveBeenCalledWith('workbook.stored-file-rejected', {
      page: PAGE,
      recordId: RECORD_ID,
      code: 'NOT_XLSX',
      reason: null,
    });
    const { status, body } = problemDetailsForError(thrown);
    expect(status).toBe(409);
    expect(JSON.stringify(body)).not.toContain('NOT_XLSX');
  });

  it('maps a format selection rejection to STORED_FILE_UNRECOGNIZED', () => {
    expect(storedReason(new WorkbookFileRejection('SHEET_NOT_FOUND'))).toBe(
      'STORED_FILE_UNRECOGNIZED',
    );
  });

  it('rethrows anything else untouched', () => {
    const plain = new Error('boom');
    expect(captureThrow(() => toStoredFileError(plain, STORED))).toBe(plain);
  });
});
