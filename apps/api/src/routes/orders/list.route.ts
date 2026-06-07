import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as orderService from '../../services/order.service';
import { ListOrdersResponseSchema, listOrdersQuerySchema } from '../../validators/order.validator';

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

const listOrdersRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/orders',
  tags: ['Orders'],
  summary: 'List orders for a store',
  description:
    'Returns paginated orders sorted by orderDate desc, with composable filters: status, ' +
    'reconciliationStatus, date range (from/to on orderDate), and a substring search (q) ' +
    'over platformOrderNumber and platformOrderId. Designed for the orders table — page + ' +
    'perPage pagination, not cursor.',
  security: [{ bearerAuth: [] }],
  request: {
    params: storeScopeParams,
    query: listOrdersQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListOrdersResponseSchema } },
      description: 'Paginated list of orders',
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

app.openapi(listOrdersRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const filters = c.req.valid('query');
  await requireStoreAccess(userId, orgId, storeId);

  const { data, total, counts } = await orderService.listOrders(orgId, storeId, filters);

  const totalPages = total === 0 ? 0 : Math.ceil(total / filters.perPage);

  return c.json(
    {
      data,
      pagination: {
        page: filters.page,
        perPage: filters.perPage,
        total,
        totalPages,
      },
      counts,
    },
    200,
  );
});

export default app;
