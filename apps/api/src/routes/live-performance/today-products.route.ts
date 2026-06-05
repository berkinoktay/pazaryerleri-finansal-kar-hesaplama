import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getTodayProducts } from '../../services/live-performance.service';
import { LivePerformanceTodayProductsSchema } from '../../validators/live-performance.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const storeScopeParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

const todayProductsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/live-performance/today-products',
  tags: ['Live Performance'],
  summary: 'Products that sold today (orders ∪ buffer, per barcode)',
  description:
    'Every product variant that sold today, one row per barcode, merged over the business-day ' +
    "universe (the calculated orders table ∪ today's cost-missing buffer). Each row reports " +
    'distinct order count, units sold and net revenue (all known without cost) plus a ' +
    'cost-status flag and the costed net unit cost. No per-product profit. Money values are ' +
    'Decimal strings; counts are ints.',
  security: [{ bearerAuth: [] }],
  request: { params: storeScopeParams },
  responses: {
    200: {
      content: { 'application/json': { schema: LivePerformanceTodayProductsSchema } },
      description: "Today's products list",
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
      description: 'Store not found or not accessible',
    },
    429: Common429Response,
  },
});

app.openapi(todayProductsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  await requireStoreAccess(userId, orgId, storeId);

  const data = await getTodayProducts({ orgId, storeId });
  return c.json({ data }, 200);
});

export default app;
