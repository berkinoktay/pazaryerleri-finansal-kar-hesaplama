import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { ensureOrgMember } from '../../lib/ensure-org-member';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as costProfileService from '../../services/cost-profile.service';
import {
  CostProfileVersionSchema,
  ListCostProfileVersionsResponseSchema,
} from '../../validators/cost-profile.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const profileParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: 'id', in: 'path' } }),
});

const paginationQuery = z.object({
  cursor: z.string().optional().openapi({ description: 'Opaque cursor from previous page.' }),
  limit: z.coerce.number().int().min(1).max(100).default(25).openapi({ example: 25 }),
});

const listVersionsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/cost-profiles/{id}/versions',
  tags: ['CostProfiles'],
  summary: 'List version history for a cost profile',
  description:
    'Returns all version snapshots for the profile, ordered newest-first. Each version ' +
    'records which fields changed (changedFields[]) and who made the change (changedBy).',
  security: [{ bearerAuth: [] }],
  request: {
    params: profileParams,
    query: paginationQuery,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListCostProfileVersionsResponseSchema } },
      description: 'Paginated version history',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    403: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Not a member of this organization',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Cost profile not found',
    },
    429: Common429Response,
  },
});

app.openapi(listVersionsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, id } = c.req.valid('param');
  const { cursor, limit } = c.req.valid('query');
  const organizationId = await ensureOrgMember(userId, orgId);

  const { items, nextCursor } = await costProfileService.getCostProfileVersions(
    organizationId,
    id,
    { cursor, limit },
  );

  const data = items.map(
    (v): z.infer<typeof CostProfileVersionSchema> => ({
      id: v.id,
      profileId: v.profileId,
      organizationId: v.organizationId,
      version: v.version,
      name: v.name,
      type: v.type,
      amountGross: v.amountGross.toString(),
      currency: v.currency,
      vatRate: Number(v.vatRate),
      fxRateMode: v.fxRateMode,
      manualFxRate: v.manualFxRate !== null ? v.manualFxRate.toString() : null,
      note: v.note,
      archivedAt: v.archivedAt?.toISOString() ?? null,
      changedFields: v.changedFields,
      changedBy: v.changedBy,
      changedAt: v.changedAt.toISOString(),
      changeReason: v.changeReason,
    }),
  );

  return c.json(
    {
      data,
      meta: {
        nextCursor,
        hasMore: nextCursor !== null,
        limit,
      },
    },
    200,
  );
});

export default app;
