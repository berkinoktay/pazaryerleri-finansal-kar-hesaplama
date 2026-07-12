// Org-scoped sync-log routes (separate from the store-scoped ones in
// `product.routes.ts`). The store-scoped variants live alongside the
// product sync trigger because that's where they grew up; this file
// hosts the org-wide endpoint so the path-shape — `/organizations/:orgId/
// sync-logs` — has a natural home.

import { createRoute, z } from '@hono/zod-openapi';
import { syncLog, syncLogService } from '@pazarsync/sync-core';
import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../lib/create-hono-app';
import { assertCapability, requireCapability } from '../lib/require-capability';
import { accessibleStoreIds, requireStoreAccess } from '../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../openapi';
import * as syncTriggerService from '../services/sync-trigger.service';
import {
  StartSyncResponseSchema,
  SyncLogListResponseSchema,
  TriggerSyncBodySchema,
  toSyncLogResponse,
} from '../validators/product.validator';

const app = createSubApp<{
  Variables: { userId: string };
}>();

const orgSyncLogsParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
});

const orgSyncLogsQuery = z.object({
  active: z
    .enum(['true', 'false'])
    .optional()
    .openapi({
      param: { name: 'active', in: 'query' },
      description:
        'When `true`, omit recent COMPLETED/FAILED rows and return only active syncs. ' +
        'Retained for backward compatibility — no web caller uses it today (the org-wide ' +
        'SyncBadge that consumed active-only mode was removed). `freshness` is still ' +
        'returned in this mode.',
    }),
});

const storeSyncParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

// ─── GET /sync-logs (org-wide, active + recent) ───────────────────────

const listOrgSyncLogsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/sync-logs',
  tags: ['Sync'],
  summary: 'List active + recent sync logs across the organization',
  description:
    'Returns every active sync (PENDING / RUNNING / FAILED_RETRYABLE) plus the last 5 ' +
    'completed/failed runs across every store the user can see. Active rows come first, ' +
    'sorted newest first. The `freshness` array carries the last successful run per ' +
    '(store, syncType) independent of the recent-5 cap on `data`, and is returned in both ' +
    'the default and `active=true` modes. The `active=true` mode has no web caller today — ' +
    'the org-wide SyncBadge that drove it was removed; the query param is kept for backward ' +
    'compatibility.',
  security: [{ bearerAuth: [] }],
  request: { params: orgSyncLogsParams, query: orgSyncLogsQuery },
  responses: {
    200: {
      content: { 'application/json': { schema: SyncLogListResponseSchema } },
      description: 'Active + recent sync logs for the org',
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
    429: Common429Response,
  },
});

app.openapi(listOrgSyncLogsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  const { active } = c.req.valid('query');
  // DATA_READ membership gate that also yields the role; MEMBER/VIEWER then see
  // only their granted stores' sync logs (OWNER/ADMIN: all). Honours the
  // route's "every store the user can see" contract.
  const role = await requireCapability(userId, orgId, CAPABILITIES.DATA_READ);
  const storeIds = await accessibleStoreIds(userId, orgId, role);
  // Same store narrowing feeds both the active/recent list and the freshness
  // feed, so MEMBER/VIEWER never see a last-success row for a store they were
  // not granted.
  const storeScope = storeIds === null ? {} : { storeIds };
  const [logs, freshness] = await Promise.all([
    syncLogService.listOrgActiveAndRecent(orgId, {
      activeOnly: active === 'true',
      ...storeScope,
    }),
    syncLogService.listLastSuccessfulPerType(orgId, storeScope),
  ]);
  return c.json({ data: logs.map(toSyncLogResponse), freshness }, 200);
});

// ─── POST /stores/:storeId/syncs — generic manual sync trigger ────────
// Supersedes the PRODUCTS-only POST /stores/:storeId/products/sync. Same
// auth / store-access / cooldown / conflict contract, but the sync type is
// chosen in the body so one endpoint drives every merchant-triggerable
// sync (ORDERS / PRODUCTS / SETTLEMENTS / CLAIMS).

const triggerSyncRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/syncs',
  tags: ['Sync'],
  summary: 'Enqueue a manual marketplace sync (generic across sync type)',
  description:
    'Inserts a PENDING MANUAL SyncLog row for the requested `syncType` and returns 202 with ' +
    'the new syncLogId. The dedicated worker (apps/sync-worker) claims it within ~1 s and runs ' +
    'the sync in the background; clients poll ' +
    '`GET /v1/organizations/:orgId/stores/:storeId/sync-logs/:syncLogId` or subscribe to ' +
    'Supabase Realtime to track progress. A second manual trigger for the same (store, syncType) ' +
    'inside its cooldown window returns 429 RATE_LIMITED with `Retry-After`; an already-active ' +
    'sync for that slot returns 409 SYNC_IN_PROGRESS with `meta.existingSyncLogId`. Accepts ' +
    'ORDERS / PRODUCTS / SETTLEMENTS / CLAIMS — PRODUCTS_DELTA is rejected as a cron-internal type.',
  security: [{ bearerAuth: [] }],
  request: {
    params: storeSyncParams,
    body: {
      content: { 'application/json': { schema: TriggerSyncBodySchema } },
    },
  },
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
      description: 'Not a member of this organization, or role lacks the sync capability',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Store not found (or not accessible to the caller)',
    },
    409: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'A sync of this type is already running for this store',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid body (unknown or non-triggerable syncType)',
    },
    429: Common429Response,
  },
});

app.openapi(triggerSyncRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { syncType } = c.req.valid('json');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.SYNC_TRIGGER);

  // Manual enqueue: enforce the per-(store, syncType) cooldown, then INSERT a
  // PENDING MANUAL SyncLog row and return. A second manual trigger inside the
  // cooldown window returns 429 RATE_LIMITED (+ Retry-After); an already-active
  // slot returns 409 SyncInProgressError from acquireSlot. The worker picks the
  // row up via tryClaimNext within ~1 s.
  const log = await syncTriggerService.triggerManualSync(orgId, store.id, syncType);

  syncLog.info('trigger.enqueued', {
    syncLogId: log.id,
    organizationId: orgId,
    storeId: store.id,
    syncType,
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
