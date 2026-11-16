import { ApiError, type ProblemDetails } from '@/lib/api-error';

/** One field issue of a backend `422 VALIDATION_ERROR`. */
export type ValidationFieldIssue = NonNullable<ProblemDetails['errors']>[number];

/**
 * The field issues of a backend `422 VALIDATION_ERROR` (empty for any other error).
 * `VALIDATION_ERROR` is silenced by the global toast pipeline, so the upload and
 * config forms render these issues inline themselves.
 */
export function validationIssues(error: unknown): ValidationFieldIssue[] {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return [];
  return error.problem.errors ?? [];
}

/**
 * The `VALIDATION_ERROR` issues whose field has no message slot on screen (`placedFields`
 * lists the fields that have one). A dialog renders these itself, so an issue on a field it
 * has no input for is never swallowed. Empty for any other error.
 */
export function unplacedIssues(
  error: unknown,
  placedFields: readonly string[],
): ValidationFieldIssue[] {
  return validationIssues(error).filter((issue) => !placedFields.includes(issue.field));
}

/** Code of the `413` the API answers when an upload body exceeds its size limit. */
const PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE';

/** The file rejection of an import: its code and the meta the API sent with it. */
export interface UploadFileIssue {
  readonly code: string;
  readonly meta: Readonly<Record<string, unknown>>;
}

/**
 * Pulls the file rejection out of an import mutation error. The backend rejects a bad
 * upload in one of two shapes, both silenced by the global toast pipeline, so the upload
 * dialog shows it inline itself:
 *
 * - `422 VALIDATION_ERROR` with a field-level `{ field: 'file', code, meta? }` (a file code
 *   of `@pazarsync/utils`, such as `WRONG_FILE_FOR_PAGE` with its detected page, or an
 *   engine code such as `NOT_XLSX`): the issue's code and meta (`{}` when it has none).
 * - `413 PAYLOAD_TOO_LARGE` when the body exceeds the upload size limit: it carries no
 *   `errors[]`, so the problem's own code is returned with an empty meta.
 *
 * Returns null for any other error, and for a `422` without a `file` issue.
 */
export function extractFileIssue(error: unknown): UploadFileIssue | null {
  if (error instanceof ApiError && error.code === PAYLOAD_TOO_LARGE) {
    return { code: PAYLOAD_TOO_LARGE, meta: {} };
  }
  const issue = validationIssues(error).find((candidate) => candidate.field === 'file');
  if (issue === undefined) return null;
  return { code: issue.code, meta: issue.meta ?? {} };
}
