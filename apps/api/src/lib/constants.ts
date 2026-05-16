/**
 * Cross-module constants. Inline string literals for header names are
 * a smell — the same string appears in the middleware that stamps it,
 * the error handler that reads it back, and tests that assert on it.
 * One typo and the correlation id chain breaks silently.
 */

/**
 * Response (and inbound) header carrying the request correlation id.
 * Stamped by `requestIdMiddleware`, read by `app.onError` to populate
 * `meta.requestId` on ProblemDetails bodies, and quoted in support
 * tickets to find the matching server log line.
 */
export const REQUEST_ID_HEADER = 'X-Request-Id';
