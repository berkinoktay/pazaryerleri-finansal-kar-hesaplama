import { createRoute } from '@hono/zod-openapi';

import { UnauthorizedError } from '../lib/errors';
import { createSubApp } from '../lib/create-hono-app';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../openapi';
import * as userProfileService from '../services/user-profile.service';
import { MeResponseSchema } from '../validators/user-profile.validator';

const app = createSubApp<{ Variables: { userId: string; email: string } }>();

const getMeRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Me'],
  summary: 'Get the authenticated user’s profile',
  description:
    'Returns the profile for the user whose Bearer token authenticates the request. ' +
    'Used by the frontend to render timestamps in the viewer’s timezone and preselect ' +
    'UI language. Defensive upsert — never 404s for an authenticated user.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { 'application/json': { schema: MeResponseSchema } },
      description: 'The user’s profile',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    429: Common429Response,
  },
});

app.openapi(getMeRoute, async (c) => {
  const userId = c.get('userId');
  const email = c.get('email');
  if (email === undefined || email.length === 0) {
    throw new UnauthorizedError('Authenticated user has no email on file');
  }
  const profile = await userProfileService.getOrCreateByUserId(userId, email);
  return c.json(profile, 200);
});

export default app;
