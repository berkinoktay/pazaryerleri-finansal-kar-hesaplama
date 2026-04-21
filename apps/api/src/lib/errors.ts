/**
 * Domain errors that the `app.onError` handler translates to RFC 7807
 * ProblemDetails responses. The `code` field is SCREAMING_SNAKE_CASE and
 * stable across minor releases — the frontend maps it to i18n strings.
 */

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  readonly code = 'UNAUTHENTICATED' as const;

  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  readonly code = 'FORBIDDEN' as const;

  constructor(message = 'Access denied') {
    super(message);
    this.name = 'ForbiddenError';
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
 * Marketplace itself is down / timed out / 5xx. 503 tells the client to
 * retry later; the underlying issue is upstream, not our data.
 */
export class MarketplaceUnreachable extends Error {
  readonly status = 503 as const;
  readonly code = 'MARKETPLACE_UNREACHABLE' as const;
  readonly platform: string;
  readonly meta: { httpStatus: number };

  constructor(platform: string, meta: { httpStatus: number }) {
    super(`Marketplace unreachable (${meta.httpStatus.toString()}) — upstream issue`);
    this.name = 'MarketplaceUnreachable';
    this.platform = platform;
    this.meta = meta;
  }
}
