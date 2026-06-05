import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getBufferDetail } from '../../services/live-performance.service';
import { BufferDetailSchema } from '../../validators/live-performance.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const bufferScopeParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
  bufferId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'bufferId', in: 'path' } }),
});

const bufferDetailRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/live-performance/buffer/{bufferId}',
  tags: ['Live Performance'],
  summary: 'Cost-missing buffer entry detail (enriched lines)',
  description:
    "A pending (buffer) order's detail from its mapped payload, each line enriched with " +
    'product name + thumbnail via a barcode to ProductVariant lookup. No fees or profit (none ' +
    'exist until the order graduates). Money values are Decimal strings.',
  security: [{ bearerAuth: [] }],
  request: { params: bufferScopeParams },
  responses: {
    200: {
      content: { 'application/json': { schema: BufferDetailSchema } },
      description: 'Buffer detail',
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
      description: 'Store or buffer entry not found',
    },
    429: Common429Response,
  },
});

app.openapi(bufferDetailRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, bufferId } = c.req.valid('param');
  await requireStoreAccess(userId, orgId, storeId);
  const result = await getBufferDetail({ orgId, storeId, bufferId });
  return c.json(result, 200);
});

export default app;
