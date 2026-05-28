import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getTopProducts } from '../../services/live-performance.service';
import { LivePerformanceTopProductsSchema } from '../../validators/live-performance.validator';

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

const topProductsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/live-performance/top-products',
  tags: ['Live Performance'],
  summary: 'Top 3 products sold today',
  description:
    'The three best-selling product variants of the business day so far, ranked by order ' +
    'count, with revenue and best-effort profit. profit is null when any contributing order ' +
    'has no estimate yet. Money values are Decimal strings.',
  security: [{ bearerAuth: [] }],
  request: { params: storeScopeParams },
  responses: {
    200: {
      content: { 'application/json': { schema: LivePerformanceTopProductsSchema } },
      description: 'Top products list (max 3)',
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

app.openapi(topProductsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  await requireStoreAccess(userId, orgId, storeId);

  const data = await getTopProducts({ orgId, storeId });
  return c.json({ data }, 200);
});

export default app;
