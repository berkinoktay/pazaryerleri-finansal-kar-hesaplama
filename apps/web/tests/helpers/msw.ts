import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/**
 * Default base URL for tests — matches the api-client's fallback when
 * NEXT_PUBLIC_API_URL is unset. Tests can override per-handler if needed.
 */
const TEST_API_BASE = 'http://localhost:3001';

/**
 * Sample handlers for the routes that exist today. As more endpoints land,
 * add their default handlers here. Individual tests can override with
 * `server.use(http.get(...))` for non-default scenarios (errors, slow
 * responses, etc).
 */
export const defaultHandlers = [
  http.get(`${TEST_API_BASE}/v1/organizations`, () => {
    return HttpResponse.json({
      data: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Test Organization',
          slug: 'test-org',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
  }),

  http.get(`${TEST_API_BASE}/v1/health`, () => {
    return HttpResponse.json({ status: 'ok' });
  }),
];

export const server = setupServer(...defaultHandlers);

export { http, HttpResponse };
