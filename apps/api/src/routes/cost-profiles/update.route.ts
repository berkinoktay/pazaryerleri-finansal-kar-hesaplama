import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { ensureOrgMember } from '../../lib/ensure-org-member';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as costProfileService from '../../services/cost-profile.service';
import {
  CostProfileSchema,
  updateCostProfileSchema,
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

const updateCostProfileRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/cost-profiles/{id}',
  tags: ['CostProfiles'],
  summary: 'Update a cost profile',
  description:
    'Partial update. Only the provided fields are changed. Appends a version row with the ' +
    'diff of changed fields. Uses SELECT FOR UPDATE to serialize concurrent PATCHes.',
  security: [{ bearerAuth: [] }],
  request: {
    params: profileParams,
    body: {
      content: { 'application/json': { schema: updateCostProfileSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CostProfileSchema } },
      description: 'Updated cost profile',
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
    409: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'New name is already taken within the organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Validation failed',
    },
    429: Common429Response,
  },
});

app.openapi(updateCostProfileRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, id } = c.req.valid('param');
  const patch = c.req.valid('json');
  const organizationId = await ensureOrgMember(userId, orgId);

  const profile = await costProfileService.updateCostProfile(organizationId, id, patch, userId);

  const body: z.infer<typeof CostProfileSchema> = {
    id: profile.id,
    organizationId: profile.organizationId,
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
