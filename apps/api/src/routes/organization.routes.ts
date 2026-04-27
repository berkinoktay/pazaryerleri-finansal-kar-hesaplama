import { createRoute, z } from '@hono/zod-openapi';
import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

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

const orgIdParam = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
});

const recordOrgAccessRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/access',
  tags: ['Organizations'],
  summary: 'Record that the caller accessed this organization',
  description:
    "Updates the caller's organization_members.last_accessed_at to NOW(). " +
    'Called by the frontend when the user switches into an org so the next ' +
    'sign-in can resume the most-recently-used context. The membership check ' +
    "is implicit: the Prisma update's where-clause filters by (userId, orgId), " +
    "so a non-member's update affects zero rows and Prisma raises P2025 — " +
    'which `mapPrismaError` translates to NotFoundError → 404. This means ' +
    'cross-tenant attempts and missing-org are indistinguishable, preventing ' +
    'existence leak (SECURITY.md §3).',
  security: [{ bearerAuth: [] }],
  request: { params: orgIdParam },
  responses: {
    204: { description: 'Access timestamp updated' },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Organization not found, or caller is not a member',
    },
    429: Common429Response,
  },
});

app.openapi(recordOrgAccessRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');

  try {
    await prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      data: { lastAccessedAt: new Date() },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return c.body(null, 204);
});

export default app;
