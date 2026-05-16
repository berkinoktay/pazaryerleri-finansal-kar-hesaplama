import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Single source of truth for the Supabase service-role client used by
 * the backend. Two callers exist:
 *   - `auth.middleware.ts` — verifies the inbound Bearer token via
 *     `supabase.auth.getUser`.
 *   - `tests/helpers/auth.ts` — creates real Supabase Auth users for
 *     integration tests via the admin API.
 *
 * Both paths need the same `(url, secret)` env contract and the same
 * "no session persistence" config; having two copies invited drift
 * (different error messages, different cache lifetimes, etc).
 *
 * Cached at module scope — the client is stateless and thread-safe per
 * the Supabase JS docs. The first call validates env vars; subsequent
 * calls are zero-cost.
 *
 * Note: this is the SERVICE-ROLE / SECRET client (bypasses RLS). Never
 * expose it to user-supplied input paths. The publishable-key anon
 * client used by tests for sign-in stays separate (see tests/helpers/auth.ts).
 */

let cached: SupabaseClient | undefined;

export function getSupabaseAdminClient(): SupabaseClient {
  if (cached !== undefined) return cached;
  const url = process.env['SUPABASE_URL'];
  const secret = process.env['SUPABASE_SECRET_KEY'];
  if (url === undefined || url.length === 0 || secret === undefined || secret.length === 0) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be configured on the server.');
  }
  cached = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
