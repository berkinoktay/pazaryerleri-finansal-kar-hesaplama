import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { ensureOrgMember } from '../../lib/ensure-org-member';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as costProfileService from '../../services/cost-profile.service';
import {
  AttachedVariantSchema,
  ListAttachedVariantsResponseSchema,
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

const listAttachedVariantsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/cost-profiles/{id}/attached-variants',
  tags: ['CostProfiles'],
  summary: 'List product variants attached to a cost profile',
  description:
    'Returns product variants linked to the cost profile via product_variant_cost_profiles. ' +
    'Ordered by attachedAt descending. Includes the variant barcode, stockCode, and parent ' +
    'product title for display.',
  security: [{ bearerAuth: [] }],
  request: {
    params: profileParams,
    query: paginationQuery,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListAttachedVariantsResponseSchema } },
      description: 'Paginated list of attached variants',
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

app.openapi(listAttachedVariantsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, id } = c.req.valid('param');
  const { cursor, limit } = c.req.valid('query');
  const organizationId = await ensureOrgMember(userId, orgId);

  const { items, nextCursor } = await costProfileService.getAttachedVariants(organizationId, id, {
    cursor,
    limit,
  });

  const data = items.map(
    (link): z.infer<typeof AttachedVariantSchema> => ({
      linkId: link.linkId,
      productVariantId: link.productVariantId,
      barcode: link.barcode,
      stockCode: link.stockCode,
      productId: link.productId,
      productTitle: link.productTitle,
      attachedAt: link.attachedAt.toISOString(),
      attachedBy: link.attachedBy,
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
