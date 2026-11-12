import { SpreadsheetFileError, workerLimitReason } from '@pazarsync/spreadsheet';
import { syncLog } from '@pazarsync/sync-core';

import { IMPORT_BUSY_RETRY_AFTER_SECONDS } from '../config/workbook-limits';
import { ConflictError, ImportBusyError, ValidationError } from './errors';

/**
 * Catch-side mappers for `readWorkbookGrid` failures. The engine throws a neutral
 * `SpreadsheetFileError`; these turn it into the API's domain errors so every
 * import and export answers the same way.
 *
 * `ENGINE_BUSY` means the process-wide parse queue is full (or a parse waited too
 * long for its turn), not that the file is bad: both mappers answer it with
 * `ImportBusyError` (503 + Retry-After) so the client can retry.
 *
 * The parse runs in a worker with a heap and a time limit. A kill arrives as
 * `PAYLOAD_TOO_LARGE` with a worker reason (`workerLimitReason`); both mappers log
 * it as `spreadsheet.worker-limit` and map it per caller, see each function.
 *
 * The error `meta` is never passed on: it can name zip entries or quote library
 * messages about the file.
 */

type WorkerLimit = ReturnType<typeof workerLimitReason>;

/** The worker limit that killed the parse, logged; null (and no log) when none did. */
function logWorkerLimit(err: SpreadsheetFileError): WorkerLimit {
  const reason = workerLimitReason(err);
  if (reason !== null) syncLog.warn('spreadsheet.worker-limit', { reason, code: err.code });
  return reason;
}

/**
 * For a file the seller just uploaded: a file error becomes a field-level
 * `ValidationError` on `file` carrying the engine code (422). A worker kill, for
 * memory or for time, stays a 422 `PAYLOAD_TOO_LARGE`: every step of the parse is
 * linear and the largest file the caps admit parses in seconds, so a parse that runs
 * past the time limit is the file, not the load. Answering it as retryable would
 * invite retries that each hold the single parse worker for the whole time limit.
 *
 *   try { grid = await readWorkbookGrid(input.file) } catch (err) { mapUploadedFileError(err); }
 */
export function mapUploadedFileError(err: unknown): never {
  if (!(err instanceof SpreadsheetFileError)) throw err;
  logWorkerLimit(err);
  if (err.code === 'ENGINE_BUSY') throw new ImportBusyError(IMPORT_BUSY_RETRY_AFTER_SECONDS);
  throw new ValidationError([{ field: 'file', code: err.code }]);
}

/**
 * For a stored source file an export reads back. It parsed cleanly at import, so
 * if the bytes no longer read, that is a conflict with the stored server state
 * (409 with `message`), not a server bug (500). A worker kill on such a file is a
 * capacity condition rather than a changed file, so it answers `ImportBusyError`
 * (503) like `ENGINE_BUSY`.
 *
 *   try { grid = await readWorkbookGrid(source) } catch (err) { mapStoredFileError(err, '...'); }
 */
export function mapStoredFileError(err: unknown, message: string): never {
  if (!(err instanceof SpreadsheetFileError)) throw err;
  const workerLimit = logWorkerLimit(err);
  if (err.code === 'ENGINE_BUSY' || workerLimit !== null) {
    throw new ImportBusyError(IMPORT_BUSY_RETRY_AFTER_SECONDS);
  }
  throw new ConflictError(message);
}
