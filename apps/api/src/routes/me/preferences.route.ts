import { createRoute } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { UnauthorizedError } from '../../lib/errors';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as userProfileService from '../../services/user-profile.service';
import {
  PreferencesResponseSchema,
  PreferencesSchema,
} from '../../validators/preferences.validator';

const app = createSubApp<{ Variables: { userId: string; email: string } }>();

// ─── GET /v1/me/preferences ───────────────────────────────────────────────────

const getPreferencesRoute = createRoute({
  method: 'get',
  path: '/me/preferences',
  tags: ['Me'],
  summary: "Get the authenticated user's preferences",
  description:
    'Returns the preferences blob for the user whose Bearer token authenticates the request. ' +
    'Defaults to {} if the user has never set any preferences (opt-in design). ' +
    'Scoped exclusively to the authenticated user — the profile row is looked up by the ' +
    'JWT subject (userId from authMiddleware), never from a caller-supplied id.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { 'application/json': { schema: PreferencesResponseSchema } },
      description: "The authenticated user's current preferences.",
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    429: Common429Response,
  },
});

app.openapi(getPreferencesRoute, async (c) => {
  const userId = c.get('userId');
  if (userId === undefined || userId.length === 0) {
    throw new UnauthorizedError('Authenticated user id missing from context');
  }
  const prefs = await userProfileService.getPreferences(userId);
  return c.json({ data: prefs }, 200);
});

// ─── PATCH /v1/me/preferences ─────────────────────────────────────────────────

const patchPreferencesRoute = createRoute({
  method: 'patch',
  path: '/me/preferences',
  tags: ['Me'],
  summary: "Shallow-merge updates into the authenticated user's preferences",
  description:
    'Accepts a partial preferences object and shallow-merges it into the stored blob. ' +
    'Only the top-level keys present in the request body are overwritten; ' +
    'omitted keys are left unchanged. Scoped exclusively to the authenticated user — ' +
    'the profile row is updated by JWT subject (userId from authMiddleware), ' +
    'never from a caller-supplied id.',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: PreferencesSchema } },
      description: 'Partial preferences to merge into the stored blob.',
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PreferencesResponseSchema } },
      description: 'The full preferences blob after the merge.',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Validation error — e.g. descending bucket thresholds',
    },
    429: Common429Response,
  },
});

app.openapi(patchPreferencesRoute, async (c) => {
  const userId = c.get('userId');
  if (userId === undefined || userId.length === 0) {
    throw new UnauthorizedError('Authenticated user id missing from context');
  }
  const patch = c.req.valid('json');
  const email = c.get('email') ?? '';
  const updated = await userProfileService.patchPreferences(userId, email, patch);
  return c.json({ data: updated }, 200);
});

export default app;
