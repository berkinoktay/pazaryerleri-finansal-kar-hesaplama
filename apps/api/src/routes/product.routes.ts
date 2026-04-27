import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../lib/create-hono-app';
import { ensureOrgMember } from '../lib/ensure-org-member';
import { runInBackground } from '../lib/run-in-background';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../openapi';
import * as productSyncService from '../services/product-sync.service';
import * as productsListService from '../services/products-list.service';
import * as storeService from '../services/store.service';
import * as syncLogService from '../services/sync-log.service';
import {
  ListProductsQuerySchema,
  ListProductsResponseSchema,
  ProductFacetsResponseSchema,
  StartSyncResponseSchema,
  SyncLogListResponseSchema,
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

  const log = await syncLogService.acquireSlot(organizationId, store.id, 'PRODUCTS');

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

// ─── GET /sync-logs (active + recent) — hydrate SyncCenter ────────────

const listActiveSyncLogsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/sync-logs',
  tags: ['Sync'],
  summary: 'List active + recent sync logs',
  description:
    'Returns every RUNNING sync log for the store plus the last 5 completed/failed runs. ' +
    'Generic across SyncType (PRODUCTS today, ORDERS / SETTLEMENTS later). Used by the ' +
    'SyncCenter UI to hydrate before the Supabase Realtime channel takes over — and as ' +
    'the polling fallback when the WebSocket drops.',
  security: [{ bearerAuth: [] }],
  request: { params: storeIdParams },
  responses: {
    200: {
      content: { 'application/json': { schema: SyncLogListResponseSchema } },
      description: 'Active + recent sync logs',
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
    429: Common429Response,
  },
});

app.openapi(listActiveSyncLogsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const organizationId = await ensureOrgMember(userId, orgId);
  await storeService.requireOwnedStore(organizationId, storeId);
  const logs = await syncLogService.listActiveAndRecent(organizationId, storeId);
  return c.json({ data: logs.map(toSyncLogResponse) }, 200);
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

// ─── GET /products — paginated, filterable list ────────────────────────

const listProductsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/products',
  tags: ['Products'],
  summary: 'List synced products with filters and pagination',
  description:
    'Returns parent products from our local cache (synced from Trendyol). The `variants[]` ' +
    'in each product is filtered to those matching the `status` query param when one is ' +
    'supplied; the parent is included whenever at least one of its variants matches. Search ' +
    '(`q`) hits Product.title, Product.productMainId, and ProductVariant.barcode / .stockCode ' +
    '(case-insensitive substring match). Pagination is offset-based and 1-indexed; perPage ' +
    'is locked to {10, 25, 50, 100}.',
  security: [{ bearerAuth: [] }],
  request: {
    params: storeIdParams,
    query: ListProductsQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListProductsResponseSchema } },
      description: 'Paginated product list',
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

app.openapi(listProductsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const filters = c.req.valid('query');
  const organizationId = await ensureOrgMember(userId, orgId);
  await storeService.requireOwnedStore(organizationId, storeId);
  const result = await productsListService.list({ organizationId, storeId, filters });
  return c.json(result, 200);
});

// ─── GET /products/facets — brand + category dropdowns ─────────────────

const productFacetsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/products/facets',
  tags: ['Products'],
  summary: 'Distinct brands and categories with row counts',
  description:
    'Two cheap GROUP BY queries over the synced products table — used to populate the ' +
    'product list toolbar dropdowns (brand, category) without a separate paginated read. ' +
    'Each entry includes the count of products in that bucket. Sorted by count descending.',
  security: [{ bearerAuth: [] }],
  request: { params: storeIdParams },
  responses: {
    200: {
      content: { 'application/json': { schema: ProductFacetsResponseSchema } },
      description: 'Brand + category facets',
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
    429: Common429Response,
  },
});

app.openapi(productFacetsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const organizationId = await ensureOrgMember(userId, orgId);
  await storeService.requireOwnedStore(organizationId, storeId);
  const result = await productsListService.facets({ organizationId, storeId });
  return c.json(result, 200);
});

export default app;
