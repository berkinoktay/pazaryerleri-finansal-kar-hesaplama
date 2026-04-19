import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { ForbiddenError, UnauthorizedError } from './lib/errors';
import { authMiddleware } from './middleware/auth.middleware';
import { bearerAuthScheme } from './openapi';
import organizationRoutes from './routes/organization.routes';

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
  const app = new OpenAPIHono().basePath('/v1');

  app.use('*', logger());
  app.use('*', cors());

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', bearerAuthScheme);

  // Domain errors thrown anywhere downstream map to RFC 7807 ProblemDetails
  // responses here. The `code` field is SCREAMING_SNAKE_CASE and stable —
  // the frontend translates it to i18n strings. Unknown errors collapse to
  // a generic 500 that never leaks internals to the client.
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) {
      return c.json(
        {
          type: 'https://api.pazarsync.com/errors/unauthenticated',
          title: 'Authentication required',
          status: 401,
          code: err.code,
          detail: err.message,
        },
        401,
      );
    }
    if (err instanceof ForbiddenError) {
      return c.json(
        {
          type: 'https://api.pazarsync.com/errors/forbidden',
          title: 'Access denied',
          status: 403,
          code: err.code,
          detail: err.message,
        },
        403,
      );
    }
    console.error('Unhandled error:', err);
    return c.json(
      {
        type: 'https://api.pazarsync.com/errors/internal',
        title: 'Internal server error',
        status: 500,
        code: 'INTERNAL_ERROR',
        detail: 'An unexpected error occurred',
      },
      500,
    );
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

  // ─── Authenticated routes ──────────────────────────────────────────
  app.route('/', organizationRoutes);

  return app;
}
