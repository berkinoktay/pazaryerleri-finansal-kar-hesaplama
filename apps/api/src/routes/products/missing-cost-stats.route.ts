import { createRoute, z } from '@hono/zod-openapi';
import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { requireCapability } from '../../lib/require-capability';
import { accessibleStoreIds } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { missingCostStats } from '../../services/products-list.service';

const app = createSubApp<{ Variables: { userId: string } }>();

const orgIdParam = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
});

const MissingCostStatsResponseSchema = z
  .object({
    count: z
      .number()
      .int()
      .nonnegative()
      .openapi({
        description:
          "Number of variants in the default listing scope (still in Trendyol's feed, not " +
          'ARCHIVED) with no active (non-archived) cost profile attached.',
        example: 42,
      }),
    missingProductCount: z
      .number()
      .int()
      .nonnegative()
      .openapi({
        description:
          'Number of products with at least one of those variants. A product counts once ' +
          'however many of its variants miss cost.',
        example: 17,
      }),
    totalVariants: z.number().int().nonnegative().openapi({
      description:
        'Number of variants in the default listing scope across the stores the caller can see.',
      example: 350,
    }),
    byStore: z
      .array(
        z.object({
          storeId: z.string().uuid().openapi({ example: '1c1b9b3a-4f2d-49a8-9c5e-3a2f1d8b9c0e' }),
          missingCount: z.number().int().nonnegative().openapi({ example: 15 }),
          missingProductCount: z.number().int().nonnegative().openapi({ example: 6 }),
          totalVariants: z.number().int().nonnegative().openapi({ example: 120 }),
        }),
      )
      .openapi({
        description:
          'Per-store breakdown, ordered by storeId. Lists every store with at least one ' +
          'variant in the default listing scope; stores with missingCount = 0 are still ' +
          "included so the UI can calculate totals. Each row carries the store's own counts " +
          'so a store-scoped view can render "N products / M variants missing" for just the ' +
          'active store.',
      }),
  })
  .openapi('MissingCostStatsResponse');

const missingCostStatsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/products/missing-cost-stats',
  tags: ['Products'],
  summary: 'Count variants and products with no active cost profile',
  description:
    "Returns how many variants in the default listing scope (still in Trendyol's feed, not " +
    'ARCHIVED) have zero attached (non-archived) cost profiles, how many products those ' +
    'variants belong to, and a per-store breakdown. Uses the same scope and the same ' +
    '"missing cost" rule as the products list overrideMissing=cost view and the facets ' +
    'missingCost badge. Used to populate the missing-cost banner on the products page and ' +
    'the dashboard widget.',
  security: [{ bearerAuth: [] }],
  request: { params: orgIdParam },
  responses: {
    200: {
      content: { 'application/json': { schema: MissingCostStatsResponseSchema } },
      description: 'Missing cost stats',
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
    429: Common429Response,
  },
});

app.openapi(missingCostStatsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  // Org-wide aggregate: gate on DATA_READ (every member) and narrow the byStore
  // breakdown to the caller's granted stores so a MEMBER/VIEWER can't enumerate
  // stores they were not granted (null = OWNER/ADMIN, meaning all stores).
  const role = await requireCapability(userId, orgId, CAPABILITIES.DATA_READ);
  const storeIds = await accessibleStoreIds(userId, orgId, role);
  const stats = await missingCostStats(orgId, storeIds);
  return c.json(stats, 200);
});

export default app;
