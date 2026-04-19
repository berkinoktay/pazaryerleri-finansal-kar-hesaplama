import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

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

  app.openapi(healthRoute, (c) => c.json({ status: 'ok' as const }, 200));

  app.route('/', organizationRoutes);

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

  return app;
}
