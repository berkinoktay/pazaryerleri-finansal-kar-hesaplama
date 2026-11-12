import { SpreadsheetFileError } from '@pazarsync/spreadsheet';

import { IMPORT_BUSY_RETRY_AFTER_SECONDS } from '../config/workbook-limits';
import { ConflictError, ImportBusyError, ValidationError } from './errors';

/**
 * Catch-side mappers for `readWorkbookGrid` / `parseXlsx` failures. The engine
 * throws a neutral `SpreadsheetFileError`; these turn it into the API's domain
 * errors so every import and export answers the same way.
 *
 * `ENGINE_BUSY` means the process-wide parse queue is full, not that the file is
 * bad: both mappers answer it with `ImportBusyError` (503 + Retry-After) so the
 * client can retry. The error `meta` is never passed on: it can name zip
 * entries or quote library messages about the file.
 */

/**
 * For a file the seller just uploaded: a file error becomes a field-level
 * `ValidationError` on `file` carrying the engine code (422).
 *
 *   try { grid = await readWorkbookGrid(input.file) } catch (err) { mapUploadedFileError(err); }
 */
export function mapUploadedFileError(err: unknown): never {
  if (!(err instanceof SpreadsheetFileError)) throw err;
  if (err.code === 'ENGINE_BUSY') throw new ImportBusyError(IMPORT_BUSY_RETRY_AFTER_SECONDS);
  throw new ValidationError([{ field: 'file', code: err.code }]);
}

/**
 * For a stored source file an export reads back. It parsed cleanly at import, so
 * if the bytes no longer read, that is a conflict with the stored server state
 * (409 with `message`), not a server bug (500).
 *
 *   try { grid = await readWorkbookGrid(source) } catch (err) { mapStoredFileError(err, '...'); }
 */
export function mapStoredFileError(err: unknown, message: string): never {
  if (!(err instanceof SpreadsheetFileError)) throw err;
  if (err.code === 'ENGINE_BUSY') throw new ImportBusyError(IMPORT_BUSY_RETRY_AFTER_SECONDS);
  throw new ConflictError(message);
}
