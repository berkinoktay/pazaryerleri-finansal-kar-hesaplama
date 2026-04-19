import { errors as joseErrors, jwtVerify } from 'jose';

import { UnauthorizedError } from './errors';

export interface SupabaseJwtClaims {
  userId: string;
  email: string | undefined;
}

/**
 * Verify a Supabase-issued JWT locally with HS256 + JWT_SECRET.
 *
 * Trade-off: assumes the legacy symmetric signing mode. When we migrate
 * to asymmetric signing keys (Supabase Dashboard → JWT Signing Keys),
 * swap `jwtVerify(token, secret, ...)` for `jwtVerify(token, jwks, ...)`
 * where `jwks = createRemoteJWKSet(new URL(JWKS_URL))`. No calling-site
 * change required — this interface stays the same.
 *
 * Throws `UnauthorizedError` on any failure (expired, wrong signature,
 * missing claims, malformed, misconfigured env). The caller's job is to
 * surface a 401, not to distinguish among causes.
 */
export async function verifySupabaseJwt(token: string): Promise<SupabaseJwtClaims> {
  const secret = process.env['JWT_SECRET'];
  if (secret === undefined || secret.length === 0) {
    throw new UnauthorizedError('JWT_SECRET is not configured');
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    });

    const sub = payload.sub;
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new UnauthorizedError('Token is missing a valid `sub` claim');
    }
    const email = typeof payload['email'] === 'string' ? payload['email'] : undefined;
    return { userId: sub, email };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    if (err instanceof joseErrors.JWTExpired) {
      throw new UnauthorizedError('Token has expired');
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      throw new UnauthorizedError('Token signature is invalid');
    }
    throw new UnauthorizedError('Invalid token');
  }
}
