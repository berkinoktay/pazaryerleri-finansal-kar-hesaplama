import { cookies } from 'next/headers';

import { createServerClient } from '@supabase/ssr';

/**
 * Supabase client for Server Components, Server Actions, and Route
 * Handlers. Reads session from Next's `cookies()` store; writes flow
 * back through the same store so the response carries refreshed
 * cookies when needed.
 *
 * Writes may no-op when called from a pure Server Component render
 * (Next.js forbids setting cookies there). That's harmless — the
 * middleware at proxy.ts also refreshes the session and is the
 * canonical writer. The try/catch keeps Server Component renders
 * from crashing when Supabase's auto-refresh tries to write.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  if (url === undefined || url.length === 0) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  }
  if (publishableKey === undefined || publishableKey.length === 0) {
    throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required');
  }

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — Next forbids writes here.
          // proxy.ts handles the refresh path; safe to ignore.
        }
      },
    },
  });
}
