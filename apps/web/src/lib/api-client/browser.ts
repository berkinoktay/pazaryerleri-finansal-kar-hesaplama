import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';

import { makeApiClient } from '../api-client';

/**
 * Pre-configured API client for Client Components. Reads the current
 * session from the browser Supabase client on every request (so the
 * Bearer header reflects the latest token after sign-in or refresh).
 *
 * Supabase client is lazy-initialised on first request. Module-scope
 * construction would throw at import time in test environments that
 * haven't set NEXT_PUBLIC_SUPABASE_URL — unnecessary because MSW
 * intercepts before any real network call.
 */
let cachedSupabase: SupabaseClient | undefined;

function getSupabase(): SupabaseClient {
  if (cachedSupabase === undefined) cachedSupabase = createClient();
  return cachedSupabase;
}

export const apiClient = makeApiClient({
  getAccessToken: async () => {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  },
});
