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

/** A problem with the given status and code and no field issues (a 409, the 413, a 500, ...). */
export function problemApiError(status: number, code: string): ApiError {
  return new ApiError(status, code, 'detail', {
    type: 'about:blank',
    title: 'title',
    status,
    code,
    detail: 'detail',
  });
}
