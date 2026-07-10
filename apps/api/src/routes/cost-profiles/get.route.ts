import { createRoute, z } from '@hono/zod-openapi';

import { requireCostProfileStoreAccess } from '../../lib/cost-profile-store-access';
import { createSubApp } from '../../lib/create-hono-app';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as costProfileService from '../../services/cost-profile.service';
import { CostProfileSchema } from '../../validators/cost-profile.validator';

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

const getCostProfileRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/cost-profiles/{id}',
  tags: ['CostProfiles'],
  summary: 'Get a single cost profile',
  security: [{ bearerAuth: [] }],
  request: { params: profileParams },
  responses: {
    200: {
      content: { 'application/json': { schema: CostProfileSchema } },
      description: 'The cost profile',
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

app.openapi(getCostProfileRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, id } = c.req.valid('param');
  // Membership → 403; store-access → 404 for a profile in an ungranted store
  // (cost profiles are store-scoped; non-disclosure).
  await requireCostProfileStoreAccess(userId, orgId, id);

  const profile = await costProfileService.getCostProfile(orgId, id);

  const body: z.infer<typeof CostProfileSchema> = {
    id: profile.id,
    organizationId: profile.organizationId,
    storeId: profile.storeId,
    name: profile.name,
    type: profile.type,
    amountGross: profile.amountGross.toString(),
    currency: profile.currency,
    vatRate: Number(profile.vatRate),
    fxRateMode: profile.fxRateMode,
    manualFxRate: profile.manualFxRate !== null ? profile.manualFxRate.toString() : null,
    note: profile.note,
    archivedAt: profile.archivedAt?.toISOString() ?? null,
    createdBy: profile.createdBy,
    updatedBy: profile.updatedBy,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };

  return c.json(body, 200);
});

export default app;
