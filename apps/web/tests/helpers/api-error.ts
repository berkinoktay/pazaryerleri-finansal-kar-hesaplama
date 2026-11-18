import { ApiError, type ProblemDetails } from '@/lib/api-error';

// Builders for the ApiError a mutation rejects with, so a test can hand a dialog the exact
// error a list client would pass it. The problem body has the RFC 7807 shape the API sends;
// `.problem` of a built error is also a valid body for an MSW error response.

type ValidationIssueInput = NonNullable<ProblemDetails['errors']>[number];

const VALIDATION_STATUS = 422;
const VALIDATION_CODE = 'VALIDATION_ERROR';

/** A `422 VALIDATION_ERROR` carrying the given field issues. */
export function validationApiError(issues: ValidationIssueInput[]): ApiError {
  return new ApiError(VALIDATION_STATUS, VALIDATION_CODE, 'Validation failed', {
    type: 'about:blank',
    title: 'Validation failed',
    status: VALIDATION_STATUS,
    code: VALIDATION_CODE,
    detail: 'Validation failed',
    errors: issues,
  });
}

/** The request id a built problem's `meta` carries when a test hands it extra meta keys. */
const TEST_REQUEST_ID = 'test-request-id';

/**
 * A problem with the given status and code and no field issues (a 409, the 413, a 500, ...).
 * `meta`, when given, is merged into the problem's `meta` next to a request id (the shape the
 * API stamps); without it the problem has no `meta` at all.
 */
export function problemApiError(
  status: number,
  code: string,
  meta?: Readonly<Record<string, unknown>>,
): ApiError {
  return new ApiError(status, code, 'detail', {
    type: 'about:blank',
    title: 'title',
    status,
    code,
    detail: 'detail',
    ...(meta === undefined ? {} : { meta: { requestId: TEST_REQUEST_ID, ...meta } }),
  });
}
