import { createRoute } from '@hono/zod-openapi';

import { createSubApp } from '../lib/create-hono-app';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../openapi';
import * as organizationService from '../services/organization.service';
import {
  CreateOrganizationInputSchema,
  OrganizationCreatedResponseSchema,
  OrganizationListResponseSchema,
} from '../validators/organization.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const listOrganizationsRoute = createRoute({
  method: 'get',
  path: '/organizations',
  tags: ['Organizations'],
  summary: 'List organizations the authenticated user is a member of',
  description:
    'Returns all organizations where the authenticated user has an OrganizationMember record, ' +
    'ordered by name ascending. Not paginated — typical users belong to fewer than 10 organizations.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { 'application/json': { schema: OrganizationListResponseSchema } },
      description: 'List of organizations',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    429: Common429Response,
  },
});

app.openapi(listOrganizationsRoute, async (c) => {
  const userId = c.get('userId');
  const data = await organizationService.listForUser(userId);
  return c.json({ data }, 200);
});

const createOrganizationRoute = createRoute({
  method: 'post',
  path: '/organizations',
  tags: ['Organizations'],
  summary: 'Create an organization with the caller as OWNER',
  description:
    'Creates a new organization and attaches the authenticated user as its OWNER ' +
    'in a single transaction. Slug is auto-generated from the name (slugify + ' +
    'collision handling). currency defaults to TRY, timezone to Europe/Istanbul — ' +
    'these can be edited later via organization settings.',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: CreateOrganizationInputSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: OrganizationCreatedResponseSchema } },
      description: 'The newly created organization with OWNER membership',
      headers: RateLimitHeaders,
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Request body failed validation',
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    429: Common429Response,
  },
});

app.openapi(createOrganizationRoute, async (c) => {
  const userId = c.get('userId');
  const input = c.req.valid('json');
  const created = await organizationService.createForOwner(userId, input);
  return c.json(created, 201);
});

export default app;
