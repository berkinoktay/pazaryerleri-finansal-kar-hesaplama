/**
 * Frontend mirror of the backend's RFC 7807 ProblemDetails. Imported by
 * every api function — a single place that knows how to turn an
 * openapi-fetch `{ error, response }` pair into a typed throw.
 *
 * Consumers should rely on `.code` for branching / i18n, `.status` for
 * HTTP-level decisions (e.g. retry), and `.problem.errors` for
 * field-level validation details.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: Array<{ field: string; code: string; meta?: Record<string, unknown> }>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly problem: ProblemDetails;

  constructor(status: number, code: string, detail: string, problem: ProblemDetails) {
    super(`[${status.toString()} ${code}] ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.problem = problem;
  }
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['type'] === 'string' &&
    typeof v['title'] === 'string' &&
    typeof v['status'] === 'number' &&
    typeof v['code'] === 'string' &&
    typeof v['detail'] === 'string'
  );
}

/**
 * Convert an openapi-fetch error body into a thrown `ApiError`. Covers:
 *   - Backend ProblemDetails → full fidelity (`code`, `detail`, `errors`).
 *   - Non-ProblemDetails body (e.g., upstream 502 HTML) → UNKNOWN_ERROR
 *     with the HTTP status preserved.
 *   - `undefined` body + `undefined` response → NETWORK_ERROR (status 0).
 *
 * Always throws — call at the top of any api function after destructuring
 * openapi-fetch's `{ error, response }`.
 */
export function throwApiError(error: unknown, response: Response | undefined): never {
  if (isProblemDetails(error)) {
    throw new ApiError(error.status, error.code, error.detail, error);
  }

  if (response === undefined) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed', {
      type: 'https://api.pazarsync.com/errors/network',
      title: 'Network error',
      status: 0,
      code: 'NETWORK_ERROR',
      detail: 'Network request failed',
    });
  }

  throw new ApiError(
    response.status,
    'UNKNOWN_ERROR',
    `Unexpected response ${response.status.toString()}`,
    {
      type: 'https://api.pazarsync.com/errors/unknown',
      title: 'Unknown error',
      status: response.status,
      code: 'UNKNOWN_ERROR',
      detail: `Unexpected response ${response.status.toString()}`,
    },
  );
}
