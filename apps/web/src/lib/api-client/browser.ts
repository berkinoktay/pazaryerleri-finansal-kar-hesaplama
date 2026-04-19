import { createClient } from '@/lib/supabase/client';

import { makeApiClient } from '../api-client';

/**
 * Pre-configured API client for Client Components. Reads the current
 * session from the browser Supabase client on every request (so the
 * Bearer header reflects the latest token after sign-in or refresh).
 *
 * Safe to import at module scope from Client Components — the
 * underlying Supabase browser client is a thin wrapper around cookies,
 * no network calls until a method is invoked.
 */
const supabase = createClient();

export const apiClient = makeApiClient({
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});
