import { UPLOAD_QUOTA_LIMITS } from '@pazarsync/utils';

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

/** The Advantage import's field naming the commission tariff that supplies the reduced rates. */
export const COMMISSION_SOURCE_FIELD = 'commissionSourceTariffId';

/** Code of the `commissionSourceTariffId` issue when the pinned commission tariff no longer exists. */
export const INVALID_COMMISSION_SOURCE = 'INVALID_COMMISSION_SOURCE';

/**
 * Whether an import error refused the pinned commission source because that commission tariff
 * no longer exists: a `422 VALIDATION_ERROR` with `{ field: 'commissionSourceTariffId', code:
 * 'INVALID_COMMISSION_SOURCE' }`. False for any other error.
 */
export function hasInvalidCommissionSource(error: unknown): boolean {
  return validationIssues(error).some(
    (issue) => issue.field === COMMISSION_SOURCE_FIELD && issue.code === INVALID_COMMISSION_SOURCE,
  );
}

/**
 * Code of the `413` the API answers when an upload body exceeds its size limit, and of the
 * engine's size refusal on `file`.
 */
export const PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE';

/** A limit the API sent in an error's meta: a positive finite number. */
export function isPositiveLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

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

/** A key of an error's meta that its declared type does not name, read as unknown. */
function metaValue(meta: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(meta, key)?.value;
}

/** Code of the `409` the API answers when the store's upload quota is reached. */
const UPLOAD_QUOTA_EXCEEDED = 'UPLOAD_QUOTA_EXCEEDED';

/**
 * Which upload quota a `409 UPLOAD_QUOTA_EXCEEDED` names, with its maximum: the per-page list
 * limit, or the store-wide stored file limit (bytes over every campaign page). `limit: null`
 * when the conflict carries no recognised limit (an older API).
 */
export type UploadQuotaIssue =
  | { readonly limit: typeof UPLOAD_QUOTA_LIMITS.LISTS; readonly maxLists: number }
  | { readonly limit: typeof UPLOAD_QUOTA_LIMITS.BYTES; readonly maxBytes: number }
  | { readonly limit: null };

/**
 * Pulls the quota refusal out of an import mutation error. The API answers a full quota with
 * `409 UPLOAD_QUOTA_EXCEEDED` and `meta: { limit: 'lists', maxLists }` or
 * `meta: { limit: 'bytes', maxBytes }`; the global toast pipeline silences it, so the upload
 * dialog shows it inline with its limit.
 *
 * Returns null for any other error. A quota refusal whose meta names no known limit with a
 * positive finite maximum answers `{ limit: null }`.
 */
export function extractQuotaIssue(error: unknown): UploadQuotaIssue | null {
  if (!(error instanceof ApiError) || error.code !== UPLOAD_QUOTA_EXCEEDED) return null;
  const meta = error.problem.meta;
  if (meta === undefined) return { limit: null };

  // The quota keys ride next to `requestId` in the problem's meta; read them as unknown.
  const limit = metaValue(meta, 'limit');
  const maxLists = metaValue(meta, 'maxLists');
  if (limit === UPLOAD_QUOTA_LIMITS.LISTS && isPositiveLimit(maxLists)) {
    return { limit: UPLOAD_QUOTA_LIMITS.LISTS, maxLists };
  }
  const maxBytes = metaValue(meta, 'maxBytes');
  if (limit === UPLOAD_QUOTA_LIMITS.BYTES && isPositiveLimit(maxBytes)) {
    return { limit: UPLOAD_QUOTA_LIMITS.BYTES, maxBytes };
  }
  return { limit: null };
}
