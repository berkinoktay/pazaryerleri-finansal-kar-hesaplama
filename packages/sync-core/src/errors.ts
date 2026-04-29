/**
 * Domain errors shared between the API process and the sync worker
 * process. Both consume these (route handlers triggering a sync,
 * decrypting credentials, mapping Prisma errors, updating SyncLog rows),
 * so they live in `@pazarsync/sync-core` rather than `apps/api/src/lib`.
 *
 * `apps/api/src/lib/errors.ts` re-exports them so existing call sites
 * continue to import from `../lib/errors` unchanged.
 */

export interface ValidationIssue {
  field: string;
  code: string;
  meta?: Record<string, unknown>;
}

export class ValidationError extends Error {
  readonly status = 422 as const;
  readonly code = 'VALIDATION_ERROR' as const;
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(`Validation failed on ${issues.length.toString()} field(s)`);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class NotFoundError extends Error {
  readonly status = 404 as const;
  readonly code = 'NOT_FOUND' as const;

  constructor(resource: string, id?: string) {
    super(id !== undefined ? `${resource} ${id} not found` : `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  readonly status = 409 as const;
  readonly code = 'CONFLICT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class InvalidReferenceError extends Error {
  readonly status = 422 as const;
  readonly code = 'INVALID_REFERENCE' as const;
  readonly meta: { field: string; value: string };

  constructor(field: string, value: string) {
    super(`Invalid reference on field '${field}': '${value}' does not exist`);
    this.name = 'InvalidReferenceError';
    this.meta = { field, value };
  }
}

export class RateLimitedError extends Error {
  readonly status = 429 as const;
  readonly code = 'RATE_LIMITED' as const;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = 'Too many requests') {
    super(message);
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Marketplace rejected our credentials (401 or a generic 4xx that is
 * not obviously an access/environment issue). Maps to 422 because it is
 * user-submitted data (API keys) that failed remote validation.
 */
export class MarketplaceAuthError extends Error {
  readonly status = 422 as const;
  readonly code = 'MARKETPLACE_AUTH_FAILED' as const;
  readonly platform: string;

  constructor(platform: string, message = 'Marketplace rejected the provided credentials') {
    super(message);
    this.name = 'MarketplaceAuthError';
    this.platform = platform;
  }
}

/**
 * Marketplace denied access due to environment-specific policy (e.g.
 * Trendyol sandbox IP whitelist missing → 503; or 403 on a prod
 * endpoint that requires additional entitlement). Distinct from
 * MarketplaceAuthError so the frontend can explain what to do next.
 */
export class MarketplaceAccessError extends Error {
  readonly status = 422 as const;
  readonly code = 'MARKETPLACE_ACCESS_DENIED' as const;
  readonly platform: string;
  readonly meta: { httpStatus: number };

  constructor(platform: string, meta: { httpStatus: number }) {
    super(
      `Marketplace denied access (${meta.httpStatus.toString()}) — likely environment-specific policy`,
    );
    this.name = 'MarketplaceAccessError';
    this.platform = platform;
    this.meta = meta;
  }
}

/**
 * A sync (PRODUCTS / ORDERS / SETTLEMENTS) is already active for the
 * same store. Active = status in {PENDING, RUNNING, FAILED_RETRYABLE};
 * the partial unique index `sync_logs_active_slot_uniq` atomically
 * enforces one active row per (storeId, syncType) at the database
 * level. `acquireSlot` catches the resulting Prisma P2002 and throws
 * this error with `meta.existingSyncLogId` set so the UI can navigate
 * to the live run.
 */
export class SyncInProgressError extends Error {
  readonly status = 409 as const;
  readonly code = 'SYNC_IN_PROGRESS' as const;
  readonly meta: { syncType: string; storeId: string; existingSyncLogId?: string };

  constructor(meta: { syncType: string; storeId: string; existingSyncLogId?: string }) {
    super(`A ${meta.syncType} sync is already running for store ${meta.storeId}`);
    this.name = 'SyncInProgressError';
    this.meta = meta;
  }
}

/**
 * Marketplace itself is down / timed out / 5xx. 503 tells the client to
 * retry later; the underlying issue is upstream, not our data.
 *
 * `meta.url`, `meta.xRequestId` and `meta.responseBodySnippet` are
 * captured by the marketplace HTTP layer when retries are exhausted.
 * They are not used by the API surface (we never leak upstream details
 * to end users), but the worker stores them in `SyncLog.skippedPages`
 * so that:
 *   - operators can correlate failures with Trendyol via X-Request-ID,
 *   - the diagnostic record survives across sync runs,
 *   - support can identify which exact URL / payload tripped the bug.
 *
 * Snippet is bounded to 1KB at capture-time — see `safeReadBody` in
 * the marketplace package.
 */
export class MarketplaceUnreachable extends Error {
  readonly status = 503 as const;
  readonly code = 'MARKETPLACE_UNREACHABLE' as const;
  readonly platform: string;
  readonly meta: {
    httpStatus: number;
    url?: string;
    xRequestId?: string;
    responseBodySnippet?: string;
  };

  constructor(
    platform: string,
    meta: {
      httpStatus: number;
      url?: string;
      xRequestId?: string;
      responseBodySnippet?: string;
    },
  ) {
    super(`Marketplace unreachable (${meta.httpStatus.toString()}) — upstream issue`);
    this.name = 'MarketplaceUnreachable';
    this.platform = platform;
    this.meta = meta;
  }
}
