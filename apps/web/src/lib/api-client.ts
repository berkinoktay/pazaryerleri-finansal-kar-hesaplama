import { createApiClient, type Middleware, type paths } from '@pazarsync/api-client';

/**
 * Factory for the typed API client. Callers provide a `getAccessToken`
 * that returns the current Supabase access token (or null for anon).
 * The middleware injects it as `Authorization: Bearer <jwt>` on every
 * outgoing request.
 *
 * Two pre-built instances exist:
 *   - `@/lib/api-client/browser` → Client Components (browser Supabase)
 *   - `@/lib/api-client/server`  → Server Components / Actions / Route
 *                                   Handlers (server Supabase, cookie
 *                                   store per request → factory function)
 *
 * The two instances share this factory so request shape, error handling,
 * and typing stay identical across execution contexts.
 */
export interface ApiClientOptions {
  getAccessToken: () => Promise<string | null>;
}

export function makeApiClient({ getAccessToken }: ApiClientOptions) {
  const baseUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
  const client = createApiClient<paths>({ baseUrl });

  const authMiddleware: Middleware = {
    async onRequest({ request }) {
      const token = await getAccessToken();
      if (token !== null) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      return request;
    },
  };
  client.use(authMiddleware);

  return client;
}
