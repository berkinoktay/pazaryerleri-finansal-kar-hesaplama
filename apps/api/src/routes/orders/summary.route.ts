import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as orderService from '../../services/order.service';
import {
  OrderSummaryResponseSchema,
  listOrdersQuerySchema,
} from '../../validators/order.validator';

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

// Same filters as the list endpoint, minus pagination/sort (an aggregate, not a page).
const summaryQuerySchema = listOrdersQuerySchema.omit({ page: true, perPage: true, sort: true });

const summaryRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/orders/summary',
  tags: ['Orders'],
  summary: 'Order KPI summary for a store',
  description:
    'Aggregates the orders that match the same filters as the list endpoint ' +
    '(status, reconciliationStatus, date range, q, costStatus, lossOnly) into headline KPIs: ' +
    'total revenue, consumed net profit, average margin, and loss-order rate. ' +
    'Pagination/sort are not accepted.',
  security: [{ bearerAuth: [] }],
  request: {
    params: storeScopeParams,
    query: summaryQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: OrderSummaryResponseSchema } },
      description: 'Aggregated KPI summary',
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
      description: 'Store not found',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid query params',
    },
    429: Common429Response,
  },
});

app.openapi(summaryRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const filters = c.req.valid('query');
  await requireStoreAccess(userId, orgId, storeId);

  const summary = await orderService.getOrdersSummary(orgId, storeId, filters);

  return c.json(summary, 200);
});

export default app;
