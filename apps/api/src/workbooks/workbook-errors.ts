// The workbook pipeline's own errors and the two catch-side mappers every import and
// export use: one for a file the seller just uploaded, one for a stored file an export
// reads back. The engine's `meta` never reaches a response: it can name zip entries or
// quote library messages about the file. What it says is logged instead, without file
// names or cell content.

import { SpreadsheetFileError, workerLimitReason } from '@pazarsync/spreadsheet';
import { syncLog } from '@pazarsync/sync-core';
import type { WorkbookPage } from '@pazarsync/utils';

import { IMPORT_BUSY_RETRY_AFTER_SECONDS } from '../config/workbook-limits';
import { ImportBusyError, ValidationError, WorkbookConflictError } from '../lib/errors';

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

/** A workbook the pipeline refuses: a 422 on `file` for an upload (`toUploadError`). */
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

/** The wire codes a page answered before this pipeline, kept per file code until the web moves. */
export type LegacyCodes = Readonly<Partial<Record<WorkbookFileCode, string>>>;

/** The engine meta's `reason`, when it is a string: a fixed rule name, never file content. */
function engineReason(err: SpreadsheetFileError): string | null {
  const reason = err.meta['reason'];
  return typeof reason === 'string' ? reason : null;
}

/** Logs the worker limit (memory or time) that killed a parse: the API's one place for that log. */
function logWorkerLimit(err: SpreadsheetFileError): void {
  const reason = workerLimitReason(err);
  if (reason !== null) syncLog.warn('spreadsheet.worker-limit', { reason, code: err.code });
}

/**
 * For everything an import throws before its transaction. A `WorkbookFileRejection`
 * becomes a 422 on `file` with its code (or the page's legacy code) and its meta. An
 * engine `ENGINE_BUSY` is the 503 `ImportBusyError`; any other engine code, a worker
 * kill included, is a 422 on `file` carrying the engine code and logged as
 * `workbook.upload-rejected`. Anything else is rethrown untouched.
 */
export function toUploadError(
  err: unknown,
  legacy: LegacyCodes,
  context: { readonly page: WorkbookPage },
): never {
  if (err instanceof WorkbookFileRejection) {
    const code = legacy[err.code] ?? err.code;
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
  });
  throw new ValidationError([{ field: 'file', code: err.code }]);
}

/**
 * For every engine call of an export, the format selection of a list without a stored
 * format id included. The stored file parsed at import, so a refusal now is a 409
 * conflict with the stored state, never a 500: a row the patch cannot find or match
 * keeps its own reason, a sheet or format that is gone is STORED_FILE_UNRECOGNIZED,
 * and every other engine code, a worker kill included, is STORED_FILE_UNREADABLE,
 * logged with its code and reason. Only `ENGINE_BUSY` is the 503 `ImportBusyError`.
 * Anything else is rethrown untouched.
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
      });
      throw new WorkbookConflictError('STORED_FILE_UNREADABLE');
    default: {
      const exhaustive: never = err.code;
      throw new Error(`Unhandled spreadsheet error code: ${String(exhaustive)}`);
    }
  }
}
