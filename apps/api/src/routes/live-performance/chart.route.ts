import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getChart } from '../../services/live-performance.service';
import { LivePerformanceChartSchema } from '../../validators/live-performance.validator';

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

const chartRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/live-performance/chart',
  tags: ['Live Performance'],
  summary: 'Live Performance hourly profit curve (today vs. yesterday)',
  description:
    'Cumulative revenue and cumulative net profit per business-timezone hour (0–23), ' +
    'for today and yesterday, for the dual-mode (ciro/kâr) intraday chart. Revenue ' +
    "includes today's cost-missing buffer; profit is the costed subset. Each hour holds " +
    'the running total through that hour. Money values are Decimal strings.',
  security: [{ bearerAuth: [] }],
  request: { params: storeScopeParams },
  responses: {
    200: {
      content: { 'application/json': { schema: LivePerformanceChartSchema } },
      description: 'Hourly cumulative profit',
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

app.openapi(chartRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  await requireStoreAccess(userId, orgId, storeId);

  const result = await getChart({ orgId, storeId });
  return c.json(result, 200);
});

export default app;
