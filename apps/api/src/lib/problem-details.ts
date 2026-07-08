import { SyncErrorCode } from '@pazarsync/db/enums';
import { EncryptionKeyError } from '@pazarsync/sync-core';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { REQUEST_ID_HEADER } from './constants';
import {
  ConflictError,
  CostProfileArchivedCannotAttachError,
  CostProfileNameTakenError,
  CostProfileNotFoundError,
  CostProfileVariantOrgMismatchError,
  ForbiddenError,
  InvalidReferenceError,
  MarketplaceAccessError,
  MarketplaceAuthError,
  MarketplaceUnreachable,
  MarketplaceWriteFailedError,
  NotFoundError,
  RateLimitedError,
  ShippingCarrierPlatformMismatchError,
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
  // Widened to ContentfulStatusCode so a passed-through `HTTPException` (e.g.
  // Hono's 400 "Malformed JSON" from a body-parse failure) can carry its own
  // status verbatim. Every hand-authored branch below still returns a specific
  // literal, all of which are members of this union.
  status: ContentfulStatusCode;
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
  // ─── Cost-profile domain errors (checked before the generic base classes) ───
  if (err instanceof CostProfileNameTakenError) {
    return {
      status: 409,
      body: {
        type: `${TYPE_BASE}/cost-profile-name-taken`,
        title: 'Cost profile name already taken',
        status: 409,
        code: 'COST_PROFILE_NAME_TAKEN',
        detail: err.message,
      },
    };
  }
  if (err instanceof CostProfileNotFoundError) {
    return {
      status: 404,
      body: {
        type: `${TYPE_BASE}/cost-profile-not-found`,
        title: 'Cost profile not found',
        status: 404,
        code: 'COST_PROFILE_NOT_FOUND',
        detail: err.message,
      },
    };
  }
  if (err instanceof CostProfileArchivedCannotAttachError) {
    return {
      status: 409,
      body: {
        type: `${TYPE_BASE}/cost-profile-archived-cannot-attach`,
        title: 'Cost profile is archived',
        status: 409,
        code: 'COST_PROFILE_ARCHIVED_CANNOT_ATTACH',
        detail: err.message,
      },
    };
  }
  if (err instanceof CostProfileVariantOrgMismatchError) {
    return {
      status: 422,
      body: {
        type: `${TYPE_BASE}/cost-profile-variant-org-mismatch`,
        title: 'Variant organization mismatch',
        status: 422,
        code: 'COST_PROFILE_VARIANT_ORG_MISMATCH',
        detail: err.message,
      },
    };
  }
  if (err instanceof ShippingCarrierPlatformMismatchError) {
    return {
      status: 422,
      body: {
        type: `${TYPE_BASE}/shipping-carrier-platform-mismatch`,
        title: 'Shipping carrier platform mismatch',
        status: 422,
        code: 'SHIPPING_CARRIER_PLATFORM_MISMATCH',
        detail: err.message,
        meta: { ...err.meta },
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
        code: SyncErrorCode.SYNC_IN_PROGRESS,
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
        code: SyncErrorCode.VALIDATION_ERROR,
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
        code: SyncErrorCode.RATE_LIMITED,
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
        code: SyncErrorCode.MARKETPLACE_AUTH_FAILED,
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
        code: SyncErrorCode.MARKETPLACE_ACCESS_DENIED,
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
        code: SyncErrorCode.MARKETPLACE_UNREACHABLE,
        detail: err.message,
        meta: { platform: err.platform, ...err.meta },
      },
    };
  }
  if (err instanceof MarketplaceWriteFailedError) {
    return {
      status: 422,
      body: {
        type: `${TYPE_BASE}/marketplace-write-failed`,
        title: 'Marketplace rejected the write',
        status: 422,
        code: 'MARKETPLACE_WRITE_FAILED',
        detail: err.message,
        meta: { ...err.meta },
      },
    };
  }
  // Hono-native HTTPException (e.g. a malformed-JSON body parse failure throws
  // a 400 before any route handler runs). Without this branch such throws
  // collapse to a generic 500, masking a deterministic client error as a
  // server fault. Kept last so the domain error classes above (which all
  // extend `Error`, not `HTTPException`) match first.
  if (err instanceof HTTPException) {
    const status = err.status;
    const isMalformed = status === 400;
    const detail = err.message.length > 0 ? err.message : 'The request could not be processed';
    return {
      status,
      body: {
        type: `${TYPE_BASE}/${isMalformed ? 'malformed-request' : 'http-error'}`,
        title: isMalformed ? 'Malformed request' : 'HTTP error',
        status,
        code: isMalformed ? 'MALFORMED_REQUEST' : 'HTTP_ERROR',
        detail,
      },
    };
  }
  return {
    status: 500,
    body: {
      type: `${TYPE_BASE}/internal`,
      title: 'Internal server error',
      status: 500,
      code: SyncErrorCode.INTERNAL_ERROR,
      detail: 'An unexpected error occurred',
    },
  };
}

/**
 * Shared error → HTTP Response bridge used by `app.onError` (app.ts) and the
 * Trendyol webhook sub-app's own `onError`. Reads the correlation id stamped
 * by `requestIdMiddleware`, maps the error via `problemDetailsForError`,
 * logs unhandled 500s, mirrors any headers (e.g. `Retry-After`), and returns
 * the RFC 7807 JSON response. Keeping it here means both error handlers share
 * one implementation instead of copying the body.
 */
export function problemDetailsResponse(err: unknown, c: Context): Response {
  const requestId = c.res.headers.get(REQUEST_ID_HEADER) ?? undefined;
  const { body, status, headers } = problemDetailsForError(err, { requestId });
  if (status === 500) {
    console.error('Unhandled error:', { requestId, err });
  }
  if (headers !== undefined) {
    for (const [name, value] of Object.entries(headers)) {
      c.header(name, value);
    }
  }
  return c.json(body, status);
}
