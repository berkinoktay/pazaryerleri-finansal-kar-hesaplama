import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { listFlashProducts } from '../../services/flash-product.service';
import {
  FlashProductListResponseSchema,
  FlashProductStorePathSchema,
} from '../../validators/flash-product.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const listFlashProductsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/flash-products',
  tags: ['FlashProducts'],
  summary: 'List saved Flash Products uploads for a store',
  description:
    'Returns one row per saved Flash Products upload for the store, with the aggregates the master ' +
    'list shows: distinct product count, item (offer row) count, how many rows already have a chosen ' +
    'offer or custom price, the exported flag and the last-updated timestamp. Newest first.',
  security: [{ bearerAuth: [] }],
  request: { params: FlashProductStorePathSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: FlashProductListResponseSchema } },
      description: 'Saved Flash Products uploads for the store',
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
      description: 'Store not found or belongs to a different organization',
    },
    429: Common429Response,
  },
});

app.openapi(listFlashProductsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const data = await listFlashProducts(orgId, storeId);
  return c.json({ data }, 200);
});

export default app;
