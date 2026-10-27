import { ApiError, type ProblemDetails } from '@/lib/api-error';

/**
 * The field issues of a backend `422 VALIDATION_ERROR` (empty for any other error).
 * `VALIDATION_ERROR` is silenced by the global toast pipeline, so the upload and
 * config forms render these issues inline themselves.
 */
export function validationIssues(error: unknown): NonNullable<ProblemDetails['errors']> {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return [];
  return error.problem.errors ?? [];
}

/**
 * Pulls the tariff-file rejection code out of an import mutation error. The
 * backend rejects a bad upload with `422 VALIDATION_ERROR` and a field-level
 * `{ field: 'file', code }` (e.g. `SHEET_NOT_FOUND`, `INVALID_TARIFF_FORMAT`,
 * `EMPTY_TARIFF_FILE`, `NO_TARIFF_PERIOD`, `NOT_XLSX`, …). `VALIDATION_ERROR` is
 * silenced by the global toast pipeline (forms show it inline), so the upload
 * dialog surfaces this code itself. Returns null for any non-file error.
 */
export function extractFileErrorCode(error: unknown): string | null {
  return validationIssues(error).find((issue) => issue.field === 'file')?.code ?? null;
}
