import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createMiddleware } from 'hono/factory';

import { UnauthorizedError } from '../lib/errors';

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

let cachedClient: SupabaseClient | undefined;

function getSupabaseClient(): SupabaseClient {
  if (cachedClient !== undefined) return cachedClient;
  const url = process.env['SUPABASE_URL'];
  const secret = process.env['SUPABASE_SECRET_KEY'];
  if (url === undefined || url.length === 0 || secret === undefined || secret.length === 0) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be configured on the server.');
  }
  cachedClient = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

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

  const { data, error } = await getSupabaseClient().auth.getUser(token);
  if (error !== null || data.user === null) {
    throw new UnauthorizedError('Invalid or expired token');
  }
  c.set('userId', data.user.id);
  c.set('email', data.user.email);
  await next();
});
