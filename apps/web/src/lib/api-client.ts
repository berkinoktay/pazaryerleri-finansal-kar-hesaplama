import { createApiClient, type Middleware, type paths } from '@pazarsync/api-client';

/**
 * Event bus for auth-related signals the apiClient emits. A Client
 * Component subscriber (SessionExpiredHandler) reacts to these by
 * signing the user out, clearing caches, and redirecting to /login.
 *
 * Module scope EventTarget is safe — it's instantiated once per
 * execution context (browser / server), and only the browser has a
 * subscriber that fires UI side effects.
 */
export const authEvents = new EventTarget();

export const AUTH_SESSION_EXPIRED = 'session-expired';

/**
 * Factory for the typed API client. Callers provide a `getAccessToken`
 * that returns the current Supabase access token (or null for anon).
 * The middleware injects it as `Authorization: Bearer <jwt>` on every
 * outgoing request. A response middleware listens for 401 replies and
 * dispatches a session-expired event on the shared authEvents bus so
 * the UI can react globally.
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
    onResponse({ response }) {
      if (response.status === 401) {
        authEvents.dispatchEvent(new Event(AUTH_SESSION_EXPIRED));
      }
      return undefined;
    },
  };
  client.use(authMiddleware);

  return client;
}
