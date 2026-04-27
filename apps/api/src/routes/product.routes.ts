import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../lib/create-hono-app';
import { ensureOrgMember } from '../lib/ensure-org-member';
import { runInBackground } from '../lib/run-in-background';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../openapi';
import * as productSyncService from '../services/product-sync.service';
import * as storeService from '../services/store.service';
import * as syncLogService from '../services/sync-log.service';
import {
  StartSyncResponseSchema,
  SyncLogResponseSchema,
  toSyncLogResponse,
} from '../validators/product.validator';

const app = createSubApp<{
  Variables: { userId: string };
}>();

const storeIdParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

const syncLogParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
  syncLogId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'syncLogId', in: 'path' } }),
});

// ─── POST /products/sync — start a Trendyol product sync ──────────────

const startSyncRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/products/sync',
  tags: ['Products'],
  summary: 'Start a Trendyol product sync',
  description:
    'Acquires the sync slot (sync_log row + race detection), kicks off the ' +
    'background sync, and returns 202 with the new syncLogId. The actual fetch + ' +
    'upsert runs in the background of the Hono process; clients poll ' +
    '`GET /v1/organizations/:orgId/stores/:storeId/sync-logs/:syncLogId` (or, with ' +
    'PR 5, subscribe to Supabase Realtime postgres_changes on the same row) to ' +
    'track progress. Concurrent sync attempts return 409 SYNC_IN_PROGRESS.',
  security: [{ bearerAuth: [] }],
  request: { params: storeIdParams },
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
      description: 'A product sync is already running for this store',
    },
    429: Common429Response,
  },
});

app.openapi(startSyncRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const organizationId = await ensureOrgMember(userId, orgId);
  const store = await storeService.requireOwnedStore(organizationId, storeId);

  const log = await syncLogService.acquireSlot(store.id, 'PRODUCTS');

  // Fire-and-forget. The service updates the SyncLog row as it progresses
  // and writes errorCode/errorMessage on failure — we never rethrow past
  // the service's own catch. runInBackground keeps a strong ref so V8
  // doesn't GC the promise mid-flight.
  runInBackground(productSyncService.run({ store, syncLogId: log.id }));

  return c.json(
    {
      syncLogId: log.id,
      status: 'RUNNING' as const,
      startedAt: log.startedAt.toISOString(),
    },
    202,
  );
});

// ─── GET /sync-logs/:syncLogId — poll a single sync's status ──────────

const getSyncLogRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/sync-logs/{syncLogId}',
  tags: ['Sync'],
  summary: 'Read a sync log row',
  description:
    'Generic across SyncType (PRODUCTS / ORDERS / SETTLEMENTS). Returns the row ' +
    'with `progressCurrent` / `progressTotal` / `progressStage` so the SyncCenter ' +
    'UI can render a progress bar without a Realtime subscription. Polling ' +
    'fallback when the WebSocket drops in PR 5.',
  security: [{ bearerAuth: [] }],
  request: { params: syncLogParams },
  responses: {
    200: {
      content: { 'application/json': { schema: SyncLogResponseSchema } },
      description: 'The sync log row',
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
      description: 'Store or sync log not found',
    },
    429: Common429Response,
  },
});

app.openapi(getSyncLogRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, syncLogId } = c.req.valid('param');
  const organizationId = await ensureOrgMember(userId, orgId);
  // Store-ownership gate before the sync-log lookup, so a cross-tenant
  // probe of `storeId` returns the same 404 as a missing store.
  await storeService.requireOwnedStore(organizationId, storeId);
  const log = await syncLogService.getById(organizationId, storeId, syncLogId);
  return c.json(toSyncLogResponse(log), 200);
});

export default app;
