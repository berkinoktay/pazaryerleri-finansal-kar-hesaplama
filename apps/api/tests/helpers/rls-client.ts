import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { createAuthenticatedTestUser, type AuthenticatedTestUser } from './auth';

/**
 * Build a Supabase JS client scoped to a real user's JWT.
 *
 * Queries made through this client go through PostgREST with
 * `Authorization: Bearer <access_token>`, which Supabase translates to
 * `SET ROLE authenticated` + populated `auth.uid()`. This is the ONLY
 * way to test RLS policies — Prisma via DATABASE_URL connects as the
 * `postgres` superuser and bypasses RLS entirely.
 *
 * Composes on `createAuthenticatedTestUser`, so the token is a genuine
 * Supabase-issued ES256 JWT (same verification path as production).
 *
 * Returns both the scoped client and the underlying user record; tests
 * typically need the user's id for factory calls (createMembership,
 * etc.) before switching to the client for the RLS-enforced query.
 */
export async function createRlsScopedClient(
  overrides: {
    email?: string;
    fullName?: string;
  } = {},
): Promise<{
  user: AuthenticatedTestUser;
  client: SupabaseClient;
}> {
  const user = await createAuthenticatedTestUser(overrides);
  const url = process.env['SUPABASE_URL'];
  const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  if (url === undefined || url.length === 0) {
    throw new Error('SUPABASE_URL is required for RLS-scoped client');
  }
  if (publishableKey === undefined || publishableKey.length === 0) {
    throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required for RLS-scoped client');
  }
  const client = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { user, client };
}

/**
 * Build a Supabase JS client with NO auth header — PostgREST sees it as
 * the `anon` role. Use to verify no tenant rows are visible without
 * authentication.
 */
export function createAnonClient(): SupabaseClient {
  const url = process.env['SUPABASE_URL'];
  const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  if (url === undefined || url.length === 0 || publishableKey === undefined) {
    throw new Error('SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required');
  }
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
