import { createRoute, z } from '@hono/zod-openapi';
import { syncLog, syncLogService } from '@pazarsync/sync-core';

import { createSubApp } from '../../lib/create-hono-app';
import { ensureOrgMember } from '../../lib/ensure-org-member';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as storeService from '../../services/store.service';
import { StartSyncResponseSchema } from '../../validators/product.validator';

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

const startOrderSyncRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/orders/sync',
  tags: ['Orders'],
  summary: 'Enqueue a Trendyol order sync',
  description:
    'Inserts a PENDING SyncLog row with syncType=ORDERS and returns 202 with the new ' +
    'syncLogId. The sync-worker claims the row via tryClaimNext (typically within ~1 s) ' +
    'and walks the configured backfill window with cursor-based pagination against ' +
    "Trendyol's getShipmentPackagesStream endpoint. Concurrent attempts return 409 " +
    'SYNC_IN_PROGRESS with meta.existingSyncLogId pointing at the live run. Webhooks ' +
    'continue to ingest new orders in real time independent of this manual trigger.',
  security: [{ bearerAuth: [] }],
  request: { params: storeScopeParams },
  responses: {
    202: {
      content: { 'application/json': { schema: StartSyncResponseSchema } },
      description: 'Sync queued',
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
    409: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'An order sync is already running for this store',
    },
    429: Common429Response,
  },
});

app.openapi(startOrderSyncRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const organizationId = await ensureOrgMember(userId, orgId);
  const store = await storeService.requireOwnedStore(organizationId, storeId);

  // Pure enqueue: INSERT a PENDING SyncLog row and return. The worker
  // claims via tryClaimNext within ~1 s. P2002 from the partial unique
  // index is mapped to SyncInProgressError(409) with meta.existingSyncLogId
  // by acquireSlot itself.
  const log = await syncLogService.acquireSlot(organizationId, store.id, 'ORDERS');

  syncLog.info('trigger.enqueued', {
    syncLogId: log.id,
    organizationId,
    storeId: store.id,
    syncType: 'ORDERS',
    userId,
    requestId: c.req.header('X-Request-Id'),
  });

  return c.json(
    {
      syncLogId: log.id,
      status: 'PENDING' as const,
      enqueuedAt: log.startedAt.toISOString(),
    },
    202,
  );
});

export default app;
