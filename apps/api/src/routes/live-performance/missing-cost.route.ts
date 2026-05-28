import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getMissingCost } from '../../services/live-performance.service';
import { LivePerformanceMissingCostSchema } from '../../validators/live-performance.validator';

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

const missingCostRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/live-performance/missing-cost',
  tags: ['Live Performance'],
  summary: 'Cost-missing variants blocking today’s buffer',
  description:
    'Variants in today’s PENDING buffer entries that still lack a cost profile, grouped ' +
    'by barcode with the order count and blocked revenue. Attaching a cost here lets the ' +
    'order graduate from the buffer into the calculated orders. Already-costed siblings of ' +
    'a still-missing line are excluded.',
  security: [{ bearerAuth: [] }],
  request: { params: storeScopeParams },
  responses: {
    200: {
      content: { 'application/json': { schema: LivePerformanceMissingCostSchema } },
      description: 'Cost-missing variant list',
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

app.openapi(missingCostRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  await requireStoreAccess(userId, orgId, storeId);

  const data = await getMissingCost({ orgId, storeId });
  return c.json({ data }, 200);
});

export default app;
