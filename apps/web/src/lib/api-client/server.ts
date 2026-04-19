import { createClient } from '@/lib/supabase/server';

import { makeApiClient } from '../api-client';

/**
 * Factory for a server-side API client. Must be called per request
 * because `cookies()` (inside the underlying Supabase server client)
 * is request-scoped — caching across requests would leak another
 * user's session.
 *
 * Use from Server Components, Server Actions, and Route Handlers.
 */
export async function getServerApiClient() {
  const supabase = await createClient();
  return makeApiClient({
    getAccessToken: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
  });
}
