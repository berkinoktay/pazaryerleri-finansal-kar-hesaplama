import { createMiddleware } from 'hono/factory';
import { randomUUID } from 'node:crypto';

/**
 * Stamps every request with a unique `X-Request-Id` header — value is
 * either echoed from an inbound header (so a client / API gateway can
 * supply its own correlation id) or newly generated server-side.
 *
 * The id lands in THREE places:
 *   1. Response header `X-Request-Id` — the client's correlation point.
 *   2. `c.res.headers` — readable by downstream middleware and the
 *      `app.onError` handler (which copies it into the error body's
 *      `meta.requestId` field).
 *   3. (Implicit) The value is deterministic for the lifetime of the
 *      request, so any log line emitted during this request should
 *      quote the same id.
 *
 * Must be mounted BEFORE any other middleware that wants to log with
 * the request id — register it immediately after `cors()` in app.ts.
 */
export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const inbound = c.req.header('X-Request-Id');
  const requestId = inbound ?? randomUUID();
  c.header('X-Request-Id', requestId);
  await next();
});
