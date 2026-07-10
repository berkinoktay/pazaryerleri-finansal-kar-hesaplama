import { createRoute, z } from '@hono/zod-openapi';
import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as costProfileService from '../../services/cost-profile.service';
import {
  CostProfileSchema,
  createCostProfileSchema,
} from '../../validators/cost-profile.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const orgIdParam = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
});

const createCostProfileRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/cost-profiles',
  tags: ['CostProfiles'],
  summary: 'Create a cost profile',
  description:
    'Creates a new cost profile and seeds its first version row (version=1, changedFields=[]). ' +
    'Profile names are unique within the store. ' +
    'MANUAL fxRateMode requires a manualFxRate. TRY currency must use AUTO fxRateMode.',
  security: [{ bearerAuth: [] }],
  request: {
    params: orgIdParam,
    body: {
      content: { 'application/json': { schema: createCostProfileSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: CostProfileSchema } },
      description: 'Cost profile created',
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
    409: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'A profile with this name already exists in the store',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Validation failed',
    },
    429: Common429Response,
  },
});

app.openapi(createCostProfileRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  const input = c.req.valid('json');
  // Store-scoped write: the caller must be able to access the target store
  // (404 for cross-org/ungranted store) AND have DATA_WRITE (blocks VIEWER).
  const { role } = await requireStoreAccess(userId, orgId, input.storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const profile = await costProfileService.createCostProfile(orgId, input, userId);

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

  return c.json(body, 201);
});

export default app;
