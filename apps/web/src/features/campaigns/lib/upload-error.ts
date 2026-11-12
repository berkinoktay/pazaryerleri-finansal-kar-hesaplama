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

/** Code of the `413` the API answers when an upload body exceeds its size limit. */
const PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE';

/**
 * Pulls the file rejection code out of an import mutation error. The backend
 * rejects a bad upload in one of two shapes, both silenced by the global toast
 * pipeline, so the upload dialog surfaces the code inline itself:
 *
 * - `422 VALIDATION_ERROR` with a field-level `{ field: 'file', code }` (e.g.
 *   `SHEET_NOT_FOUND`, `INVALID_TARIFF_FORMAT`, `EMPTY_TARIFF_FILE`,
 *   `NO_TARIFF_PERIOD`, `NOT_XLSX`, `UNSAFE_CONTENT`, …) — the issue's code.
 * - `413 PAYLOAD_TOO_LARGE` when the body exceeds the upload size limit — it
 *   carries no `errors[]`, so the problem's own code is returned.
 *
 * Returns null for any other error.
 */
export function extractFileErrorCode(error: unknown): string | null {
  if (error instanceof ApiError && error.code === PAYLOAD_TOO_LARGE) return PAYLOAD_TOO_LARGE;
  return validationIssues(error).find((issue) => issue.field === 'file')?.code ?? null;
}
