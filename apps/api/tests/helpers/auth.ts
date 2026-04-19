import { SignJWT } from 'jose';

/**
 * Signs a Supabase-shaped JWT with the current JWT_SECRET, suitable for
 * use as `Authorization: Bearer <token>` in integration tests.
 *
 * The token's `sub` claim must match an existing `user_profiles.id`
 * (create it with `createUserProfile()` from factories.ts). A missing
 * user_profile will let authMiddleware pass but org-context lookups
 * will fail with 403 at the next layer.
 */
export async function signTestJwt(
  userId: string,
  overrides: { email?: string; expiresIn?: string } = {},
): Promise<string> {
  const secret = process.env['JWT_SECRET'];
  if (secret === undefined || secret.length === 0) {
    throw new Error(
      'JWT_SECRET must be set for signTestJwt — check workspace-root .env ' +
        'or run `supabase status -o env` to fetch the local value.',
    );
  }
  return new SignJWT({
    sub: userId,
    email: overrides.email ?? `${userId}@test.local`,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? '1h')
    .sign(new TextEncoder().encode(secret));
}

/**
 * Convenience — construct a Bearer Authorization header value.
 */
export function bearer(token: string): string {
  return `Bearer ${token}`;
}
