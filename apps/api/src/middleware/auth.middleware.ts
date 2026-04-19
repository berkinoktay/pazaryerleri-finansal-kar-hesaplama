import { createMiddleware } from 'hono/factory';

import { UnauthorizedError } from '../lib/errors';
import { verifySupabaseJwt } from '../lib/jwt';

/**
 * Extracts the Bearer token from the Authorization header, verifies it,
 * and sets `userId` + `email` on the Hono context.
 *
 * Throws UnauthorizedError on any failure. `app.onError` in createApp()
 * maps it to a 401 ProblemDetails response.
 *
 * Usage:
 *   app.use('*', authMiddleware)              — applied globally
 *   app.get('/foo', authMiddleware, handler)  — applied per route
 *
 * Public routes (health, OpenAPI spec, docs UI) are mounted inside
 * createApp() BEFORE this middleware's `app.use('*')` call so they
 * bypass auth. See apps/api/src/app.ts for the wiring.
 */
export const authMiddleware = createMiddleware<{
  Variables: { userId: string; email: string | undefined };
}>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (header === undefined) {
    throw new UnauthorizedError('Missing Authorization header');
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match === null) {
    throw new UnauthorizedError('Authorization header must use Bearer scheme');
  }
  const token = match[1]!;

  const claims = await verifySupabaseJwt(token);
  c.set('userId', claims.userId);
  c.set('email', claims.email);
  await next();
});
