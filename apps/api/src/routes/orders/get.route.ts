import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as orderService from '../../services/order.service';
import { OrderDetailSchema } from '../../validators/order.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const orderScopeParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
  orderId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orderId', in: 'path' } }),
});

const getOrderRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/orders/{orderId}',
  tags: ['Orders'],
  summary: 'Get a single order with items, fees, and claims',
  description:
    'Returns the full Order graph required by the detail surface: OrderItems with joined ' +
    'variant + product image, OrderFee timeline (capturedAt asc), and OrderClaim list ' +
    '(empty until PR-13 GetClaims worker is wired).',
  security: [{ bearerAuth: [] }],
  request: { params: orderScopeParams },
  responses: {
    200: {
      content: { 'application/json': { schema: OrderDetailSchema } },
      description: 'The order detail',
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
      description: 'Store or order not found',
    },
    429: Common429Response,
  },
});

app.openapi(getOrderRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, orderId } = c.req.valid('param');
  await requireStoreAccess(userId, orgId, storeId);

  const order = await orderService.getOrderById(orgId, storeId, orderId);
  return c.json(order, 200);
});

export default app;
