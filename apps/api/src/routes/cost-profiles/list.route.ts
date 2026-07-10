import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as costProfileService from '../../services/cost-profile.service';
import {
  CostProfileSchema,
  listCostProfilesQuerySchema,
  ListCostProfilesResponseSchema,
} from '../../validators/cost-profile.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const orgIdParam = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
});

const listCostProfilesRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/cost-profiles',
  tags: ['CostProfiles'],
  summary: 'List cost profiles for an organization',
  description:
    'Returns cost profiles belonging to the organization. Defaults to active (non-archived) ' +
    'profiles when the `archived` filter is omitted. Supports cursor-based pagination, ' +
    'filtering by type, archive state, and name search.',
  security: [{ bearerAuth: [] }],
  request: {
    params: orgIdParam,
    query: listCostProfilesQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListCostProfilesResponseSchema } },
      description: 'Paginated list of cost profiles',
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
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid query params',
    },
    429: Common429Response,
  },
});

app.openapi(listCostProfilesRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  const filters = c.req.valid('query');
  // Store-scoped: validate the caller can access the requested store (also
  // enforces store∈org). 404 for a cross-org or ungranted store (non-disclosure).
  await requireStoreAccess(userId, orgId, filters.storeId);

  const { items, nextCursor } = await costProfileService.listCostProfiles(orgId, filters.storeId, {
    type: filters.type,
    archived: filters.archived,
    q: filters.q,
    cursor: filters.cursor,
    limit: filters.limit,
  });

  const data = items.map(
    (p): z.infer<typeof CostProfileSchema> => ({
      id: p.id,
      organizationId: p.organizationId,
      storeId: p.storeId,
      name: p.name,
      type: p.type,
      amountGross: p.amountGross.toString(),
      currency: p.currency,
      vatRate: Number(p.vatRate),
      fxRateMode: p.fxRateMode,
      manualFxRate: p.manualFxRate !== null ? p.manualFxRate.toString() : null,
      note: p.note,
      archivedAt: p.archivedAt?.toISOString() ?? null,
      createdBy: p.createdBy,
      updatedBy: p.updatedBy,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }),
  );

  return c.json(
    {
      data,
      meta: {
        nextCursor,
        hasMore: nextCursor !== null,
        limit: filters.limit,
      },
    },
    200,
  );
});

export default app;
