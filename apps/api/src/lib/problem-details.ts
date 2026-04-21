import { ForbiddenError, UnauthorizedError } from './errors';

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
export interface ProblemDetailsBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: Array<{ field: string; code: string; meta?: Record<string, unknown> }>;
}

export interface ProblemDetailsResult {
  body: ProblemDetailsBody;
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;
}

export function problemDetailsForError(err: unknown): ProblemDetailsResult {
  if (err instanceof UnauthorizedError) {
    return {
      status: 401,
      body: {
        type: 'https://api.pazarsync.com/errors/unauthenticated',
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
        type: 'https://api.pazarsync.com/errors/forbidden',
        title: 'Access denied',
        status: 403,
        code: 'FORBIDDEN',
        detail: err.message,
      },
    };
  }
  return {
    status: 500,
    body: {
      type: 'https://api.pazarsync.com/errors/internal',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred',
    },
  };
}
