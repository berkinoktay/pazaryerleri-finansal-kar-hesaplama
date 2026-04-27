import { EncryptionKeyError } from '@pazarsync/sync-core';

import {
  ConflictError,
  ForbiddenError,
  InvalidReferenceError,
  MarketplaceAccessError,
  MarketplaceAuthError,
  MarketplaceUnreachable,
  NotFoundError,
  RateLimitedError,
  SyncInProgressError,
  UnauthorizedError,
  ValidationError,
  type ValidationIssue,
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
 *
 * Pass `options.requestId` to stamp the response body with the request
 * correlation id — support/ops tickets can quote it to find the exact
 * server log line. Populated by `app.onError` from the `X-Request-Id`
 * response header that `requestIdMiddleware` set earlier in the chain.
 */
/**
 * Structured metadata on ProblemDetails. `requestId` is typed because
 * it is the one key every response is expected to carry (stamped by
 * app.onError from the X-Request-Id header). Error-specific keys like
 * `platform` (marketplace errors) or `httpStatus` (upstream code echo)
 * ride on the same object via the index signature.
 */
export interface ProblemDetailsMeta {
  /** Request correlation id, set by app.onError from the X-Request-Id response header. */
  requestId?: string;
  [key: string]: unknown;
}

export interface ProblemDetailsBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: ValidationIssue[];
  meta?: ProblemDetailsMeta;
}

export interface ProblemDetailsResult {
  body: ProblemDetailsBody;
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;
  headers?: Record<string, string>;
}

export interface ProblemDetailsOptions {
  /** Request correlation id — stamped onto `body.meta.requestId` if provided. */
  requestId?: string;
}

const TYPE_BASE = 'https://api.pazarsync.com/errors';

export function problemDetailsForError(
  err: unknown,
  options: ProblemDetailsOptions = {},
): ProblemDetailsResult {
  const result = classify(err);
  if (options.requestId !== undefined) {
    // Merge, not overwrite — marketplace/validation errors already set
    // their own meta (platform, httpStatus, value). requestId rides alongside.
    result.body.meta = { ...result.body.meta, requestId: options.requestId };
  }
  return result;
}

function classify(err: unknown): ProblemDetailsResult {
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
  if (err instanceof SyncInProgressError) {
    return {
      status: 409,
      body: {
        type: `${TYPE_BASE}/sync-in-progress`,
        title: 'Sync already running',
        status: 409,
        code: 'SYNC_IN_PROGRESS',
        detail: err.message,
        meta: { ...err.meta },
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
        errors: [
          { field: err.meta.field, code: 'INVALID_REFERENCE', meta: { value: err.meta.value } },
        ],
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
  if (err instanceof EncryptionKeyError) {
    return {
      status: 500,
      body: {
        type: `${TYPE_BASE}/server-config`,
        title: 'Server configuration error',
        status: 500,
        code: 'SERVER_CONFIG_ERROR',
        detail: 'An unexpected error occurred',
      },
    };
  }
  if (err instanceof MarketplaceAuthError) {
    return {
      status: 422,
      body: {
        type: `${TYPE_BASE}/marketplace-auth-failed`,
        title: 'Marketplace authentication failed',
        status: 422,
        code: 'MARKETPLACE_AUTH_FAILED',
        detail: err.message,
        meta: { platform: err.platform },
      },
    };
  }
  if (err instanceof MarketplaceAccessError) {
    return {
      status: 422,
      body: {
        type: `${TYPE_BASE}/marketplace-access-denied`,
        title: 'Marketplace access denied',
        status: 422,
        code: 'MARKETPLACE_ACCESS_DENIED',
        detail: err.message,
        meta: { platform: err.platform, ...err.meta },
      },
    };
  }
  if (err instanceof MarketplaceUnreachable) {
    return {
      status: 503,
      body: {
        type: `${TYPE_BASE}/marketplace-unreachable`,
        title: 'Marketplace unreachable',
        status: 503,
        code: 'MARKETPLACE_UNREACHABLE',
        detail: err.message,
        meta: { platform: err.platform, ...err.meta },
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
