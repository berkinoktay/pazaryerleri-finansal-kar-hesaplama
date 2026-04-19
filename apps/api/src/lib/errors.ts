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
