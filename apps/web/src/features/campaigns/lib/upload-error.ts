import { ApiError } from '@/lib/api-error';

/**
 * Pulls the tariff-file rejection code out of an import mutation error. The
 * backend rejects a bad upload with `422 VALIDATION_ERROR` and a field-level
 * `{ field: 'file', code }` (e.g. `SHEET_NOT_FOUND`, `INVALID_TARIFF_FORMAT`,
 * `EMPTY_TARIFF_FILE`, `NO_TARIFF_PERIOD`, `NOT_XLSX`, …). `VALIDATION_ERROR` is
 * silenced by the global toast pipeline (forms show it inline), so the upload
 * dialog surfaces this code itself. Returns null for any non-file error.
 */
export function extractFileErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return null;
  return error.problem.errors?.find((issue) => issue.field === 'file')?.code ?? null;
}
