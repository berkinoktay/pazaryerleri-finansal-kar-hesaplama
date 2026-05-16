import { Hono } from 'hono';

import { REQUEST_ID_HEADER } from '@/lib/constants';
import { problemDetailsForError } from '@/lib/problem-details';

/**
 * Builds a Hono test app whose `onError` handler is the SAME pure
 * mapping the production server uses (`problemDetailsForError`).
 *
 * Why this matters: hand-rolled `onError` blocks in test files drifted
 * from prod — a 500 in a test rendered `err.message` to the client,
 * while prod redacts it to `'An unexpected error occurred'` to avoid
 * internal-detail leaks. Tests that asserted on the leaked message
 * gave a false sense of behavior. Routing every test app through this
 * helper closes that gap by construction.
 *
 * Use the generic to declare the `Variables` shape the test needs to
 * `c.set()` / `c.get()` — the helper itself does not assume any
 * specific keys are present.
 *
 *   const app = createTestApp<{ userId: string; memberRole: MemberRole }>();
 *   app.use('*', authMiddleware);
 *   app.use('*', orgContextMiddleware);
 *   app.get('/echo', (c) => c.json({ ok: true }));
 */
export function createTestApp<V extends Record<string, unknown>>(): Hono<{ Variables: V }> {
  const app = new Hono<{ Variables: V }>();
  app.onError((err, c) => {
    const requestId = c.res.headers.get(REQUEST_ID_HEADER) ?? undefined;
    const { body, status, headers } = problemDetailsForError(err, { requestId });
    if (headers !== undefined) {
      for (const [name, value] of Object.entries(headers)) {
        c.header(name, value);
      }
    }
    return c.json(body, status);
  });
  return app;
}
