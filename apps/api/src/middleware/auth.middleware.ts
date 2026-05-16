import { createMiddleware } from 'hono/factory';

import { UnauthorizedError } from '../lib/errors';
import { getSupabaseAdminClient } from '../lib/supabase-admin-client';

/**
 * Extracts the Bearer token from the Authorization header, validates it via
 * Supabase's admin `getUser(token)` RPC, and sets `userId` + `email` on the
 * Hono context.
 *
 * Delegating to Supabase's SDK means the signing algorithm (HS256 / ES256),
 * claims (`aud`, `iss`, `exp`), and revocation all stay current with whatever
 * Supabase Auth is emitting — no custom JWT crypto here. Trade-off: one
 * network call per authenticated request. If latency ever matters, swap
 * for local JWKS verification (`jose.createRemoteJWKSet`) without changing
 * this function's signature or caller shape.
 *
 * Throws UnauthorizedError on any failure. `app.onError` in createApp()
 * maps it to a 401 ProblemDetails response.
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
  const token = match[1];
  if (token === undefined || token.length === 0) {
    throw new UnauthorizedError('Authorization header must use Bearer scheme');
  }

  const { data, error } = await getSupabaseAdminClient().auth.getUser(token);
  if (error !== null || data.user === null) {
    throw new UnauthorizedError('Invalid or expired token');
  }
  c.set('userId', data.user.id);
  c.set('email', data.user.email);
  await next();
});
