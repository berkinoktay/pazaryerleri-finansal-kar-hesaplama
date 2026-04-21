import {
  ConflictError,
  ForbiddenError,
  InvalidReferenceError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from './errors';

/**
 * Pure mapping from a thrown error to an RFC 7807 ProblemDetails body.
 *
 * Keeps the class→code→HTTP-status logic in one place. `app.onError` in
 * `app.ts` wraps this with `c.json(body, status)`. Tests exercise this
 * helper directly — no Hono spin-up needed.
 *
 * Unknown errors collapse to 500 INTERNAL_ERROR with a generic message.
 * The caller is responsible for logging the original `err` — we never
 * leak its `.message` to clients.
 */
export interface ValidationErrorBody {
  field: string;
  code: string;
  meta?: Record<string, unknown>;
}

export interface ProblemDetailsBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: ValidationErrorBody[];
}

export interface ProblemDetailsResult {
  body: ProblemDetailsBody;
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;
  headers?: Record<string, string>;
}

const TYPE_BASE = 'https://api.pazarsync.com/errors';

export function problemDetailsForError(err: unknown): ProblemDetailsResult {
  if (err instanceof UnauthorizedError) {
    return {
      status: 401,
      body: {
        type: `${TYPE_BASE}/unauthenticated`,
        title: 'Authentication required',
        status: 401,
        code: 'UNAUTHENTICATED',
        detail: err.message,
      },
    };
  }
  if (err instanceof ForbiddenError) {
    return {
      status: 403,
      body: {
        type: `${TYPE_BASE}/forbidden`,
        title: 'Access denied',
        status: 403,
        code: 'FORBIDDEN',
        detail: err.message,
      },
    };
  }
  if (err instanceof NotFoundError) {
    return {
      status: 404,
      body: {
        type: `${TYPE_BASE}/not-found`,
        title: 'Not found',
        status: 404,
        code: 'NOT_FOUND',
        detail: err.message,
      },
    };
  }
  if (err instanceof ConflictError) {
    return {
      status: 409,
      body: {
        type: `${TYPE_BASE}/conflict`,
        title: 'Conflict',
        status: 409,
        code: 'CONFLICT',
        detail: err.message,
      },
    };
  }
  if (err instanceof ValidationError) {
    return {
      status: 422,
      body: {
        type: `${TYPE_BASE}/validation`,
        title: 'Validation error',
        status: 422,
        code: 'VALIDATION_ERROR',
        detail: err.message,
        errors: err.issues,
      },
    };
  }
  if (err instanceof InvalidReferenceError) {
    return {
      status: 422,
      body: {
        type: `${TYPE_BASE}/invalid-reference`,
        title: 'Invalid reference',
        status: 422,
        code: 'INVALID_REFERENCE',
        detail: err.message,
        errors: [{ field: err.meta.field, code: 'INVALID_REFERENCE', meta: err.meta }],
      },
    };
  }
  if (err instanceof RateLimitedError) {
    return {
      status: 429,
      headers: { 'Retry-After': err.retryAfterSeconds.toString() },
      body: {
        type: `${TYPE_BASE}/rate-limited`,
        title: 'Too many requests',
        status: 429,
        code: 'RATE_LIMITED',
        detail: err.message,
      },
    };
  }
  return {
    status: 500,
    body: {
      type: `${TYPE_BASE}/internal`,
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred',
    },
  };
}
