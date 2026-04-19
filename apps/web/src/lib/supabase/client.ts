import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for Client Components and browser-side code.
 *
 * Sessions live in HTTP-only cookies written by `@supabase/ssr`. The
 * matching server client (`./server.ts`) reads those cookies from
 * `next/headers`; the middleware client (`./middleware.ts`) reads them
 * from the incoming request. All three must exist because Next.js
 * Server Components, Client Components, and middleware run in
 * different execution contexts with different cookie access APIs.
 */
export function createClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  if (url === undefined || url.length === 0) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  }
  if (publishableKey === undefined || publishableKey.length === 0) {
    throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required');
  }
  return createBrowserClient(url, publishableKey);
}
