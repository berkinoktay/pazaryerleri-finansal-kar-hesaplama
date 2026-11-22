import { createRoute, z } from '@hono/zod-openapi';
import { syncLog, syncLogService } from '@pazarsync/sync-core';
import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../lib/create-hono-app';
import { assertCapability } from '../lib/require-capability';
import { requireStoreAccess } from '../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../openapi';
import * as productsListService from '../services/products-list.service';
import * as productVariantService from '../services/product-variant.service';
import * as syncTriggerService from '../services/sync-trigger.service';
import {
  BulkUpdateVariantDimensionalWeightBodySchema,
  BulkUpdateVariantDimensionalWeightResponseSchema,
  ListProductsQuerySchema,
  ListProductsResponseSchema,
  ProductFacetsResponseSchema,
  StartSyncResponseSchema,
  SyncLogListResponseSchema,
  SyncLogResponseSchema,
  UpdateVariantDimensionalWeightBodySchema,
  VariantDimensionalWeightResponseSchema,
  toSyncLogResponse,
  toVariantDesiFields,
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
  summary: 'Enqueue a Trendyol product sync',
  deprecated: true,
  description:
    'Deprecated: use the generic `POST /v1/organizations/:orgId/stores/:storeId/syncs` with ' +
    '`{ "syncType": "PRODUCTS" }` instead — it applies the identical auth / cooldown / conflict ' +
    'contract across every sync type. This PRODUCTS-only route stays live during the web ' +
    'client migration and will be removed once no caller depends on it. ' +
    'Inserts a PENDING SyncLog row and returns 202 with the new syncLogId. The ' +
    'dedicated worker process (apps/sync-worker) claims the row and runs the sync ' +
    'in the background; clients poll ' +
    '`GET /v1/organizations/:orgId/stores/:storeId/sync-logs/:syncLogId` or subscribe ' +
    'to Supabase Realtime postgres_changes on the same row to track progress. ' +
    'Concurrent sync attempts return 409 SYNC_IN_PROGRESS with `meta.existingSyncLogId` ' +
    'pointing at the live run.',
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
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.SYNC_TRIGGER);

  // Manual enqueue: enforce the per-store cooldown, then INSERT a PENDING
  // MANUAL SyncLog row and return. A second manual trigger inside the
  // cooldown window returns 429 RATE_LIMITED (+ Retry-After); an already-
  // active slot still returns 409 SyncInProgressError from acquireSlot. The
  // worker picks the row up via tryClaimNext within ~1 s.
  const log = await syncTriggerService.triggerManualSync(orgId, store.id, 'PRODUCTS');

  syncLog.info('trigger.enqueued', {
    syncLogId: log.id,
    organizationId: orgId,
    storeId: store.id,
    syncType: 'PRODUCTS',
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
    'the polling fallback when the WebSocket drops. The `freshness` array carries the last ' +
    'successful run per sync type for this store, independent of the recent-5 cap on `data`.',
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
  // Store-access gate already scopes the caller to this single store, so the
  // freshness feed is scoped to it too — keeps the shared SyncLogList response
  // shape consistent with the org-wide endpoint.
  await requireStoreAccess(userId, orgId, storeId);
  const [logs, freshness] = await Promise.all([
    syncLogService.listActiveAndRecent(orgId, storeId),
    syncLogService.listLastSuccessfulPerType(orgId, { storeIds: [storeId] }),
  ]);
  return c.json({ data: logs.map(toSyncLogResponse), freshness }, 200);
});

app.openapi(getSyncLogRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, syncLogId } = c.req.valid('param');
  // Store-access gate before the sync-log lookup, so a cross-tenant or
  // ungranted-store probe of `storeId` returns the same 404 as a missing store.
  await requireStoreAccess(userId, orgId, storeId);
  const log = await syncLogService.getById(orgId, storeId, syncLogId);
  return c.json(toSyncLogResponse(log), 200);
});

// ─── GET /products — paginated, filterable list ────────────────────────

const listProductsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/products',
  tags: ['Products'],
  summary: 'List synced products with filters and pagination',
  description:
    'Returns parent products from our local cache (synced from Trendyol). Without a `status` ' +
    "param the default listing scope applies (variants still in Trendyol's feed that are " +
    'not ARCHIVED); `status` selects one variant status or DELISTED instead. The ' +
    '`variants[]` in each product holds only the variants matching the variant-level ' +
    'filters, and the parent is included whenever at least one of its variants matches. ' +
    'Search (`q`) hits Product.title, Product.productMainId, and the barcode / stockCode ' +
    'of a variant that passes the variant-level filters (case-insensitive substring ' +
    'match). Pagination is offset-based and 1-indexed; perPage is locked to ' +
    '{10, 25, 50, 100}.',
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
  await requireStoreAccess(userId, orgId, storeId);
  const result = await productsListService.list({ organizationId: orgId, storeId, filters });
  return c.json(result, 200);
});

// ─── GET /products/facets — brand + category dropdowns ─────────────────

const productFacetsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/products/facets',
  tags: ['Products'],
  summary: 'Distinct brands and categories with row counts',
  description:
    'Brand and category facets plus the tab badge counts, read from the synced products ' +
    'table with two GROUP BY queries and three counts (missing cost, missing desi, total). ' +
    'Used to populate the product list ' +
    'toolbar dropdowns (brand, category) without a separate paginated read. Each entry ' +
    'includes the count of products in that bucket. Sorted by count descending. Every ' +
    'count only includes products with at least one variant in the default listing scope ' +
    "(still in Trendyol's feed, not ARCHIVED).",
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
  await requireStoreAccess(userId, orgId, storeId);
  const result = await productsListService.facets({ organizationId: orgId, storeId });
  return c.json(result, 200);
});

// ─── PATCH variant dimensional weight (Desi user override) ─────────────

const variantIdParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
  variantId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'variantId', in: 'path' } }),
});

const setVariantDimensionalWeightRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/products/variants/{variantId}/dimensional-weight',
  tags: ['Products'],
  summary: "Set or clear the user override for a variant's dimensional weight (desi)",
  description:
    'Writes exclusively to ProductVariant.dimensional_weight_override (the user-override ' +
    'column). ' +
    "Trendyol's value lives in a sister column that this endpoint never touches — so the " +
    'override survives every subsequent sync. Pass `dimensionalWeight: null` to clear the ' +
    'override and revert the read path to the marketplace-synced value. Entering a desi ' +
    "re-checks the variant's orders of today that wait in the Live Performance buffer: an " +
    'order whose every line now has a cost and a desi moves on into profit. Stored orders ' +
    'keep the desi captured at intake.',
  security: [{ bearerAuth: [] }],
  request: {
    params: variantIdParams,
    body: {
      content: { 'application/json': { schema: UpdateVariantDimensionalWeightBodySchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: VariantDimensionalWeightResponseSchema } },
      description: 'Updated variant — effective desi, synced desi, and override flag',
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
      description: 'Store or variant not found (or belongs to a different org/store)',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid dimensional weight value',
    },
    429: Common429Response,
  },
});

app.openapi(setVariantDimensionalWeightRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, variantId } = c.req.valid('param');
  const { dimensionalWeight } = c.req.valid('json');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const updated = await productVariantService.setDimensionalWeight({
    organizationId: orgId,
    storeId,
    variantId,
    value: dimensionalWeight,
  });

  // Same desi mapper as the products list, so the effective-desi and
  // missing-desi rules exist once.
  return c.json({ id: updated.id, ...toVariantDesiFields(updated) }, 200);
});

// ─── Bulk PATCH variant dimensional weights ────────────────────────────

const bulkSetVariantDimensionalWeightRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/products/variants/dimensional-weight',
  tags: ['Products'],
  summary: 'Apply one dimensional-weight value (or clear) across many variants',
  description:
    'Same single-column write rule as the per-variant endpoint: only ' +
    "ProductVariant.dimensional_weight_override is touched. Variant IDs that don't belong to " +
    'the org+store are silently filtered out (not surfaced as an error — the UX is ' +
    '"apply to what you can"). Returns the actual updated count so the UI can warn ' +
    'when the selection went stale between click and submit. Entering a desi re-checks ' +
    "the updated variants' orders of today that wait in the Live Performance buffer, like " +
    'the per-variant endpoint; filtered-out ids trigger nothing.',
  security: [{ bearerAuth: [] }],
  request: {
    params: storeIdParams,
    body: {
      content: { 'application/json': { schema: BulkUpdateVariantDimensionalWeightBodySchema } },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: BulkUpdateVariantDimensionalWeightResponseSchema },
      },
      description: 'Bulk update applied; response carries the affected variant count',
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
      description: 'Invalid body (bad UUID, empty array, out-of-range value)',
    },
    429: Common429Response,
  },
});

app.openapi(bulkSetVariantDimensionalWeightRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { variantIds, dimensionalWeight } = c.req.valid('json');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const result = await productVariantService.bulkSetDimensionalWeight({
    organizationId: orgId,
    storeId,
    variantIds,
    value: dimensionalWeight,
  });

  return c.json(result, 200);
});

export default app;
