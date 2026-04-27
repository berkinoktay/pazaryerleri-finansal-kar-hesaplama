import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { authMiddleware } from './middleware/auth.middleware';
import { rateLimit } from './middleware/rate-limit.middleware';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import { createSubApp } from './lib/create-hono-app';
import { problemDetailsForError } from './lib/problem-details';
import { bearerAuthScheme } from './openapi';
import meRoutes from './routes/me.routes';
import organizationRoutes from './routes/organization.routes';
import productRoutes from './routes/product.routes';
import storeRoutes from './routes/store.routes';

/**
 * Builds the Hono application without side effects.
 *
 * Both the runtime entry (`index.ts`, which calls `serve()`) and tooling
 * (tests, `scripts/dump-openapi.ts`) call this factory. Keeping it free of
 * side effects means importing `app.ts` never binds a port — essential for
 * integration tests that use `app.request(...)` and for the build-time
 * OpenAPI dump that would otherwise duplicate route registration.
 */
export function createApp(): OpenAPIHono {
  const app = createSubApp().basePath('/v1');

  // Stamp every request with an X-Request-Id header (echoed if client
  // supplied one, generated otherwise). Must run first so logger() +
  // error responses can reference the same correlation id.
  app.use('*', requestIdMiddleware);
  app.use('*', logger());
  app.use('*', cors());

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', bearerAuthScheme);

  // Domain errors thrown anywhere downstream map to RFC 7807 ProblemDetails
  // responses here. The `code` field is SCREAMING_SNAKE_CASE and stable —
  // the frontend translates it to i18n strings. Unknown errors collapse to
  // a generic 500 that never leaks internals to the client.
  app.onError((err, c) => {
    // Read the correlation id stamped by requestIdMiddleware. Nullable
    // because onError is reachable from a few paths where the middleware
    // may not have run (e.g. outer Hono-level failures) — stay defensive.
    const requestId = c.res.headers.get('X-Request-Id') ?? undefined;
    const { body, status, headers } = problemDetailsForError(err, { requestId });
    if (status === 500) {
      console.error('Unhandled error:', { requestId, err });
    }
    if (headers !== undefined) {
      for (const [name, value] of Object.entries(headers)) {
        c.header(name, value);
      }
    }
    return c.json(body, status);
  });

  const healthRoute = createRoute({
    method: 'get',
    path: '/health',
    tags: ['System'],
    summary: 'Health check',
    description: 'Returns 200 when the service is up. Public endpoint, no auth required.',
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.object({ status: z.literal('ok') }).openapi('HealthResponse'),
          },
        },
        description: 'Service is healthy',
      },
    },
  });

  // ─── Public routes (mounted BEFORE authMiddleware) ──────────────────
  // Health check is public so load balancers don't need to present a JWT.
  app.openapi(healthRoute, (c) => c.json({ status: 'ok' as const }, 200));

  // Spec + Scalar docs UI — dev/staging only, and also public (they
  // document the API for developers, not end users).
  if (process.env['NODE_ENV'] !== 'production') {
    app.doc31('/openapi.json', {
      openapi: '3.1.0',
      info: {
        title: 'PazarSync API',
        version: '1.0.0',
        description:
          'Internal REST API. See `docs/plans/2026-04-16-api-docs-design.md` for conventions.',
      },
      servers: [
        { url: 'http://localhost:3001', description: 'Local dev' },
        { url: 'https://staging-api.pazarsync.com', description: 'Staging' },
      ],
      security: [{ bearerAuth: [] }],
    });

    app.get(
      '/docs',
      Scalar({
        url: '/v1/openapi.json',
        pageTitle: 'PazarSync API Reference',
      }),
    );
  }

  // ─── Auth boundary ─────────────────────────────────────────────────
  // Everything below here requires a valid Supabase Bearer token.
  app.use('*', authMiddleware);

  // ─── Global per-user rate limit (SECURITY.md §6 baseline) ──────────
  // 300 req/min matches the documented authenticated-user baseline. Per-
  // route limits (e.g. POST /stores at 5/min) layer on top inside the
  // sub-app's route definitions via the `middleware` option on createRoute.
  app.use('*', rateLimit({ max: 300, windowSec: 60, keyPrefix: 'global' }));

  // ─── Authenticated routes ──────────────────────────────────────────
  app.route('/', meRoutes);
  app.route('/', organizationRoutes);
  app.route('/', storeRoutes);
  app.route('/', productRoutes);

  return app;
}
