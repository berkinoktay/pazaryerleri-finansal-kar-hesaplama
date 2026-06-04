import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getKpis } from '../../services/live-performance.service';
import { LivePerformanceKpisSchema } from '../../validators/live-performance.validator';

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

const kpisRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/live-performance/kpis',
  tags: ['Live Performance'],
  summary: 'Live Performance KPI summary (today vs. yesterday)',
  description:
    'Revenue, order count, and units sold over the whole business day (orders plus ' +
    "today's cost-missing buffer); net profit, margin, and profit/cost ratio over the " +
    'costed subset only; plus the pending revenue/order gap awaiting cost. Today vs. ' +
    'yesterday. Money values are Decimal strings.',
  security: [{ bearerAuth: [] }],
  request: { params: storeScopeParams },
  responses: {
    200: {
      content: { 'application/json': { schema: LivePerformanceKpisSchema } },
      description: 'KPI summary',
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

app.openapi(kpisRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  await requireStoreAccess(userId, orgId, storeId);

  const result = await getKpis({ orgId, storeId });
  return c.json(result, 200);
});

export default app;
