import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { ForbiddenError } from '../../lib/errors';
import { getMembershipRole } from '../../lib/org-member-lookup';
import { accessibleStoreIds } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as attachmentService from '../../services/cost-profile-attachment.service';
import { CostProfileSchema } from '../../validators/cost-profile.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const variantParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  variantId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'variantId', in: 'path' } }),
});

const listVariantCostProfilesResponseSchema = z
  .object({ data: z.array(CostProfileSchema) })
  .openapi('ListVariantCostProfilesResponse');

const listVariantCostProfilesRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/variants/{variantId}/cost-profiles',
  tags: ['Variants'],
  summary: 'List cost profiles attached to a product variant',
  description:
    'Returns all non-archived cost profiles currently linked to the product variant, ' +
    'ordered by most-recently-attached first. The variant must belong to the organization.',
  security: [{ bearerAuth: [] }],
  request: { params: variantParams },
  responses: {
    200: {
      content: { 'application/json': { schema: listVariantCostProfilesResponseSchema } },
      description: 'Cost profiles attached to the variant',
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
      description: 'Variant not found or belongs to a different organization',
    },
    429: Common429Response,
  },
});

app.openapi(listVariantCostProfilesRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, variantId } = c.req.valid('param');

  // Membership → 403. Then narrow to the caller's accessible stores so a
  // MEMBER/VIEWER can't read the cost profiles of a variant in a store they
  // weren't granted — 422 non-disclosure, same as a cross-org variant. `null`
  // = OWNER/ADMIN (every store).
  const role = await getMembershipRole(userId, orgId);
  if (role === null) {
    throw new ForbiddenError('Not a member of this organization');
  }
  const storeIds = await accessibleStoreIds(userId, orgId, role);

  const profiles = await attachmentService.listCostProfilesForVariant(orgId, variantId, storeIds);

  const data = profiles.map(
    (profile): z.infer<typeof CostProfileSchema> => ({
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
    }),
  );

  return c.json({ data }, 200);
});

export default app;
