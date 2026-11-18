// The workbook pipeline's own errors and the two catch-side mappers every import and
// export use: one for a file the seller just uploaded, one for a stored file an export
// reads back. The engine's `meta` never reaches a response: it can name zip entries or
// quote library messages about the file. The one exception is an upload refused for its
// rows, its columns or its content: `toUploadError` rebuilds that limit from a whitelist
// (the row or column number and the one limit name), so an entry name or library text
// still never reaches a response. What the meta says is logged instead, without file
// names or cell content: the engine code, its `reason`, and for UNSAFE_CONTENT its
// `detail` (the one check that refused the file, a fixed rule name).

import {
  DEFAULT_COL_CAP,
  DEFAULT_ROW_CAP,
  isUnsafeContentDetail,
  SpreadsheetFileError,
  UPLOAD_LIMIT_REASONS,
  workerLimitReason,
  type UnsafeContentDetail,
} from '@pazarsync/spreadsheet';
import { syncLog } from '@pazarsync/sync-core';
import { WORKBOOK_FILE_LIMITS, type WorkbookFileCode, type WorkbookPage } from '@pazarsync/utils';

import { IMPORT_BUSY_RETRY_AFTER_SECONDS } from '../config/workbook-limits';
import { ImportBusyError, ValidationError, WorkbookConflictError } from '../lib/errors';

/**
 * A workbook the pipeline refuses, with one of the `WORKBOOK_FILE_CODES` of
 * `@pazarsync/utils`: a 422 on `file` for an upload (`toUploadError`).
 */
export class WorkbookFileRejection extends Error {
  readonly code: WorkbookFileCode;
  readonly meta: Readonly<Record<string, string | number | null>>;

  constructor(code: WorkbookFileCode, meta: Readonly<Record<string, string | number | null>> = {}) {
    super(`Workbook rejected: ${code}`);
    this.name = 'WorkbookFileRejection';
    this.code = code;
    this.meta = meta;
  }
}

/** Our own data broke a format rule (a value an export may not write, a kept row without anchor): a 500. */
export class WorkbookInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookInvariantError';
  }
}

/** The engine meta's `reason`, when it is a string: a fixed rule name, never file content. */
function engineReason(err: SpreadsheetFileError): string | null {
  const reason = err.meta['reason'];
  return typeof reason === 'string' ? reason : null;
}

/**
 * The engine meta's `detail` (the check behind an UNSAFE_CONTENT), when it is one of the
 * engine's fixed rule names; null otherwise, so no text the API does not know is logged.
 */
function engineDetail(err: SpreadsheetFileError): UnsafeContentDetail | null {
  const detail = err.meta['detail'];
  return isUnsafeContentDetail(detail) ? detail : null;
}

/** Logs the worker limit (memory or time) that killed a parse: the API's one place for that log. */
function logWorkerLimit(err: SpreadsheetFileError): void {
  const reason = workerLimitReason(err);
  if (reason !== null) syncLog.warn('spreadsheet.worker-limit', { reason, code: err.code });
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** An engine cap from its meta when it is a positive integer, else the cap the import reads with. */
function engineCap(value: unknown, fallback: number): number {
  return isPositiveInteger(value) ? value : fallback;
}

/**
 * The limit a seller can act on, for an upload refused for its rows, its columns or its
 * content (the DOM weight: too many filled rows), built from a whitelist: never the
 * engine meta itself. The DOM weight names the row cap because the import reads with the
 * default caps. Every other refusal carries no meta.
 */
function uploadLimitMeta(
  err: SpreadsheetFileError,
): Readonly<Record<string, string | number>> | null {
  if (err.code === 'ROW_CAP_EXCEEDED') {
    return { maxRows: engineCap(err.meta['rowCap'], DEFAULT_ROW_CAP) };
  }
  if (err.code === 'COL_CAP_EXCEEDED') {
    return { maxCols: engineCap(err.meta['colCap'], DEFAULT_COL_CAP) };
  }
  if (err.code === 'PAYLOAD_TOO_LARGE' && engineReason(err) === UPLOAD_LIMIT_REASONS.DOM_WEIGHT) {
    return { limit: WORKBOOK_FILE_LIMITS.ROWS, maxRows: DEFAULT_ROW_CAP };
  }
  return null;
}

/**
 * For everything an import throws before its transaction. A `WorkbookFileRejection`
 * becomes a 422 on `file` with its own code and its meta. An engine `ENGINE_BUSY` is the
 * 503 `ImportBusyError`; any other engine code, a worker kill included, is a 422 on
 * `file` carrying the engine code and logged as `workbook.upload-rejected` with its
 * reason and detail (engineReason, engineDetail; null when absent). The engine
 * meta stays out of that 422, except for a row, column or content refusal, whose issue
 * carries the limit `uploadLimitMeta` builds (`maxRows`, `maxCols`, or `limit` with
 * `maxRows`); an entry name or library text never does. Anything else is rethrown
 * untouched.
 */
export function toUploadError(err: unknown, context: { readonly page: WorkbookPage }): never {
  if (err instanceof WorkbookFileRejection) {
    const { code } = err;
    const meta = { ...err.meta };
    throw new ValidationError([
      Object.keys(meta).length === 0 ? { field: 'file', code } : { field: 'file', code, meta },
    ]);
  }
  if (!(err instanceof SpreadsheetFileError)) throw err;
  if (err.code === 'ENGINE_BUSY') throw new ImportBusyError(IMPORT_BUSY_RETRY_AFTER_SECONDS);
  logWorkerLimit(err);
  syncLog.info('workbook.upload-rejected', {
    page: context.page,
    code: err.code,
    reason: engineReason(err),
    detail: engineDetail(err),
  });
  const limitMeta = uploadLimitMeta(err);
  throw new ValidationError([
    limitMeta === null
      ? { field: 'file', code: err.code }
      : { field: 'file', code: err.code, meta: { ...limitMeta } },
  ]);
}

/**
 * Refuses a stored file for a rule of the pipeline's own, not an engine refusal: logs
 * `workbook.stored-file-rejected` with the fields `toStoredFileError` logs (the engine
 * `code` and `detail` null, `reason` the given fixed rule name, never a value of the
 * file) and throws WorkbookConflictError STORED_FILE_UNREADABLE, a 409.
 */
export function rejectStoredFile(
  context: { readonly page: WorkbookPage; readonly recordId: string },
  reason: string,
): never {
  syncLog.warn('workbook.stored-file-rejected', {
    page: context.page,
    recordId: context.recordId,
    code: null,
    reason,
    detail: null,
  });
  throw new WorkbookConflictError('STORED_FILE_UNREADABLE');
}

/**
 * For every engine call of an export, the format selection of a list without a stored
 * format id included. The stored file parsed at import, so a refusal now is a 409
 * conflict with the stored state, never a 500: a row the patch cannot find or match
 * keeps its own reason, a sheet or format that is gone is STORED_FILE_UNRECOGNIZED,
 * and every other engine code, a worker kill included, is STORED_FILE_UNREADABLE,
 * logged with its code, reason and detail. Only `ENGINE_BUSY` is the 503
 * `ImportBusyError`. Anything else is rethrown untouched.
 */
export function toStoredFileError(
  err: unknown,
  context: { readonly page: WorkbookPage; readonly recordId: string },
): never {
  if (err instanceof WorkbookFileRejection) {
    throw new WorkbookConflictError('STORED_FILE_UNRECOGNIZED');
  }
  if (!(err instanceof SpreadsheetFileError)) throw err;
  switch (err.code) {
    case 'ENGINE_BUSY':
      throw new ImportBusyError(IMPORT_BUSY_RETRY_AFTER_SECONDS);
    case 'ROW_NOT_FOUND':
      throw new WorkbookConflictError('ROW_NOT_FOUND');
    case 'ROW_ANCHOR_MISMATCH':
      throw new WorkbookConflictError('ROW_ANCHOR_MISMATCH');
    case 'SHEET_NOT_FOUND':
      throw new WorkbookConflictError('STORED_FILE_UNRECOGNIZED');
    case 'NOT_XLSX':
    case 'CORRUPT_FILE':
    case 'ROW_CAP_EXCEEDED':
    case 'COL_CAP_EXCEEDED':
    case 'PAYLOAD_TOO_LARGE':
    case 'UNSAFE_CONTENT':
    case 'MALFORMED_SHEET':
    case 'UNSUPPORTED_ENCODING':
      logWorkerLimit(err);
      syncLog.warn('workbook.stored-file-rejected', {
        page: context.page,
        recordId: context.recordId,
        code: err.code,
        reason: engineReason(err),
        detail: engineDetail(err),
      });
      throw new WorkbookConflictError('STORED_FILE_UNREADABLE');
    default: {
      const exhaustive: never = err.code;
      throw new Error(`Unhandled spreadsheet error code: ${String(exhaustive)}`);
    }
  }
}
