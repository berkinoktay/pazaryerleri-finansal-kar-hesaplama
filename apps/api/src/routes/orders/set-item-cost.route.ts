import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { setOrderItemCost } from '../../services/order-item-cost.service';
import { OrderDetailSchema, SetOrderItemCostBodySchema } from '../../validators/order.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const itemScopeParams = z.object({
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
  itemId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'itemId', in: 'path' } }),
});

const setItemCostRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/orders/{orderId}/items/{itemId}/cost',
  tags: ['Orders'],
  summary: 'Set a frozen per-item cost for a cost-missing order item',
  description:
    'Writes a write-once cost snapshot to a single OrderItem from a saved cost profile or a ' +
    'manual NET amount + VAT rate, then recomputes the order estimate. Frozen: once set, the ' +
    'item cost cannot be changed (409). Money values are Decimal strings.',
  security: [{ bearerAuth: [] }],
  request: {
    params: itemScopeParams,
    body: {
      content: { 'application/json': { schema: SetOrderItemCostBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: OrderDetailSchema } },
      description: 'The updated order detail',
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
      description: 'Store, order, or item not found',
    },
    409: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Item already costed (frozen) or cost unresolvable',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid body or unknown cost profile',
    },
    429: Common429Response,
  },
});

app.openapi(setItemCostRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, orderId, itemId } = c.req.valid('param');
  const body = c.req.valid('json');
  await requireStoreAccess(userId, orgId, storeId);
  const result = await setOrderItemCost({ orgId, storeId, orderId, itemId, body });
  return c.json(result, 200);
});

export default app;
