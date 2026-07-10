import { createRoute, z } from '@hono/zod-openapi';
import { CAPABILITIES } from '@pazarsync/utils';

import { assertProfileStoreAccess } from '../../lib/cost-profile-store-access';
import { createSubApp } from '../../lib/create-hono-app';
import { requireCapability } from '../../lib/require-capability';
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

const restoreCostProfileRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/cost-profiles/{id}/restore',
  tags: ['CostProfiles'],
  summary: 'Restore an archived cost profile',
  description:
    "Clears archivedAt, making the profile active again. Appends a version row with changedFields: ['archivedAt'].",
  security: [{ bearerAuth: [] }],
  request: { params: profileParams },
  responses: {
    200: {
      content: { 'application/json': { schema: CostProfileSchema } },
      description: 'Restored cost profile',
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

app.openapi(restoreCostProfileRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, id } = c.req.valid('param');
  // DATA_WRITE gate — a VIEWER (read-only) must not restore cost profiles.
  const role = await requireCapability(userId, orgId, CAPABILITIES.DATA_WRITE);
  // Store-access gate — a MEMBER may only restore a profile in a granted store
  // (404 non-disclosure). OWNER/ADMIN see every store.
  await assertProfileStoreAccess(userId, orgId, id, role);

  const profile = await costProfileService.restoreCostProfile(orgId, id, userId);

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
