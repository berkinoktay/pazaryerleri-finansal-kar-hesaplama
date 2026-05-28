import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getLiveOrders } from '../../services/live-performance.service';
import {
  LivePerformanceOrdersSchema,
  liveOrdersQuerySchema,
} from '../../validators/live-performance.validator';

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

const ordersRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/live-performance/orders',
  tags: ['Live Performance'],
  summary: 'Today’s orders (calculated + cost-missing buffer)',
  description:
    'Today’s order feed combining the calculated orders table with the cost-missing buffer, ' +
    'each row tagged by source. `filter` selects the tab: all (default), calculated (orders ' +
    'only), or pending (buffer only). `counts` always reports every tab’s total. Money values ' +
    'are Decimal strings; buffer rows have null profit/margin until they graduate.',
  security: [{ bearerAuth: [] }],
  request: { params: storeScopeParams, query: liveOrdersQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: LivePerformanceOrdersSchema } },
      description: 'Today’s live orders',
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
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid query params',
    },
    429: Common429Response,
  },
});

app.openapi(ordersRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { filter } = c.req.valid('query');
  await requireStoreAccess(userId, orgId, storeId);

  const result = await getLiveOrders({ orgId, storeId, filter });
  return c.json(result, 200);
});

export default app;
