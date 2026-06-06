import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getNewOrderNotificationSummary } from '../../services/live-performance.service';
import {
  NewOrderNotificationSummarySchema,
  notificationSummaryQuerySchema,
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

const notificationSummaryRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/live-performance/notification-summary',
  tags: ['Live Performance'],
  summary: 'Canonical revenue/profit summary for a realtime new-order toast',
  description:
    'Given a realtime INSERT event ({source, id}), returns the settled revenue (sale subtotal net), ' +
    'profit (estimated net profit; null when cost is pending), costStatus, and an isToday flag so the ' +
    'global notifier can drop backfills / historical inserts. Store-scoped (requireStoreAccess); ' +
    'money values are Decimal strings.',
  security: [{ bearerAuth: [] }],
  request: { params: storeScopeParams, query: notificationSummaryQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: NewOrderNotificationSummarySchema } },
      description: 'New-order notification summary',
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
      description: 'Store, order, or buffer entry not found',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid query params',
    },
    429: Common429Response,
  },
});

app.openapi(notificationSummaryRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { source, id } = c.req.valid('query');
  await requireStoreAccess(userId, orgId, storeId);
  const result = await getNewOrderNotificationSummary({ orgId, storeId, source, id });
  return c.json(result, 200);
});

export default app;
