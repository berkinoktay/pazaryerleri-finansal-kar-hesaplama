import { z } from 'zod';

import { SyncErrorCode } from '@pazarsync/db/enums';

/** Cursor shape for page-index pagination (Trendyol fallback). */
export const PageIndexCursorSchema = z.object({
  kind: z.literal('page'),
  n: z.number().int().min(0),
});
export type PageIndexCursor = z.infer<typeof PageIndexCursorSchema>;

/** Cursor shape for opaque-token pagination (Trendyol nextPageToken). */
export const PageTokenCursorSchema = z.object({
  kind: z.literal('token'),
  token: z.string().min(1),
});
export type PageTokenCursor = z.infer<typeof PageTokenCursorSchema>;

/** Trendyol products module's cursor (one of the two shapes). */
export const ProductsCursorSchema = z.discriminatedUnion('kind', [
  PageIndexCursorSchema,
  PageTokenCursorSchema,
]);
export type ProductsCursor = z.infer<typeof ProductsCursorSchema>;

/**
 * Parse a SyncLog.pageCursor (jsonb, possibly null) for the products
 * module. Returns null when the row has no cursor yet (fresh sync).
 * Throws ZodError if the column holds malformed data — the worker's
 * `errorCodeOf` coerces this to `SyncErrorCode.INTERNAL_ERROR` (the
 * ZodError carries no `.code` field), so the row goes through the
 * retryable path and is terminally FAILED only after MAX_ATTEMPTS.
 */
export function parseProductsCursor(raw: unknown): ProductsCursor | null {
  if (raw === null || raw === undefined) return null;
  return ProductsCursorSchema.parse(raw);
}

/**
 * Cursor shape for orders sync — windowed page-based pagination.
 *
 * Orders endpoint requires `startDate`/`endDate` window + `page` advance.
 * Initial backfill: window set on first chunk (90 days default — V1 hardcoded).
 * Subsequent chunks within same window: page advances until totalElements.
 *
 * **Deprecated by BUG #9 migration (2026-05-22):** the orders handler now
 * uses the cursor-based `getShipmentPackagesStream` endpoint. This variant
 * is preserved in the discriminated union so legacy `SyncLog.pageCursor`
 * rows still parse — the handler treats them as a fresh-start signal and
 * restarts under the new `stream-window` cursor. Will be removed in V2
 * once no `page-window` rows remain.
 */
export const OrdersPageWindowCursorSchema = z.object({
  kind: z.literal('page-window'),
  /** Trendyol startDate query param (ms epoch). */
  startDate: z.number().int().min(0),
  /** Trendyol endDate query param (ms epoch). */
  endDate: z.number().int().min(0),
  /** Page index within this window. */
  n: z.number().int().min(0),
});
export type OrdersPageWindowCursor = z.infer<typeof OrdersPageWindowCursorSchema>;

/**
 * Cursor shape for orders sync — stream endpoint (BUG #9, 2026-05-22).
 *
 * Trendyol's `getShipmentPackagesStream` is cursor-based with an opaque
 * `nextCursor` token and a 14-day per-call window cap. The handler chunks
 * the configured backfill (90 days = Trendyol's 3-month stream max) into
 * `ceil(90 / 14) = 7` sliding 14-day slices. Each tick processes one
 * cursor-page; the cursor advances either within the current chunk
 * (`streamCursor` updated) or moves to the next chunk (`chunkIndex` bumped,
 * `streamCursor` reset to null).
 *
 *   endDate         — fixed at sync start, defines the newest slice boundary.
 *   chunkIndex      — 0 = newest 14d slice, increases backwards through history.
 *   streamCursor    — Trendyol's opaque token; null = start of the slice.
 *
 * Doc rule (line 77 of getshipmentpackagesstream.md): a cursor is tied to
 * its filter — sending the same cursor with different
 * `lastModifiedStartDate/EndDate` returns 400. The handler honours this by
 * resetting `streamCursor` to null whenever `chunkIndex` changes.
 */
export const OrdersStreamWindowCursorSchema = z.object({
  kind: z.literal('stream-window'),
  /** Sync başlangıcında set + sabit. Chunk window'ları buradan hesaplanır. */
  endDate: z.number().int().min(0),
  /** 0..N-1 — newest → oldest. N = computeStreamChunkCount(store.createdAt, endDate). */
  chunkIndex: z.number().int().min(0),
  /** Trendyol opaque nextCursor; null = chunk başı (yeni stream). */
  streamCursor: z.string().nullable(),
});
export type OrdersStreamWindowCursor = z.infer<typeof OrdersStreamWindowCursorSchema>;

export const OrdersCursorSchema = z.discriminatedUnion('kind', [
  OrdersPageWindowCursorSchema,
  OrdersStreamWindowCursorSchema,
]);
export type OrdersCursor = z.infer<typeof OrdersCursorSchema>;

export function parseOrdersCursor(raw: unknown): OrdersCursor | null {
  if (raw === null || raw === undefined) return null;
  return OrdersCursorSchema.parse(raw);
}

/**
 * Ordered phases of a PRODUCTS_CHANGES run (hourly date-window scan of the
 * approved product list). A run walks every phase in this order, one page
 * per chunk, then completes.
 *
 * The values ARE Trendyol `dateQueryType` literals. sync-core cannot import
 * `@pazarsync/marketplace` (marketplace depends on sync-core), so the
 * marketplace package owns the vendor union (`TrendyolDateQueryType`) and
 * the handler's `dateQueryType: cursor.phase` assignment is the compile-time
 * check that every phase is a valid Trendyol value.
 *
 *   VARIANT_MODIFIED_DATE  - variant edits, status, lock and archive events.
 *   CONTENT_MODIFIED_DATE  - content edits the variant date misses (stage
 *                            probe: a few products only this query caught).
 *   VARIANT_CREATED_DATE   - products created days ago that Trendyol approved
 *                            late, so they only now appear in the approved
 *                            list (owner decision; the handler queries this
 *                            phase over a longer look-back than the window).
 *
 * Adding or reordering a phase is a one-line change here; the handler and
 * `nextProductsChangesPhase` derive the walk from this tuple.
 */
export const PRODUCTS_CHANGES_PHASES = [
  'VARIANT_MODIFIED_DATE',
  'CONTENT_MODIFIED_DATE',
  'VARIANT_CREATED_DATE',
] as const;
export type ProductsChangesPhase = (typeof PRODUCTS_CHANGES_PHASES)[number];

/**
 * The phase that follows `phase` in `PRODUCTS_CHANGES_PHASES`, or null when
 * `phase` is the last one (the run is done).
 */
export function nextProductsChangesPhase(phase: ProductsChangesPhase): ProductsChangesPhase | null {
  const index = PRODUCTS_CHANGES_PHASES.indexOf(phase);
  return PRODUCTS_CHANGES_PHASES[index + 1] ?? null;
}

/**
 * Cursor shape for PRODUCTS_CHANGES sync.
 *
 * The window is computed once, in the run's first chunk, and stored here so
 * every later chunk (and every retry or re-claim of the same row) queries
 * the exact same range. Bounds are ms epoch, like the orders cursors. The
 * handler derives each phase's Trendyol query range from these two bounds.
 *
 *   phase        - current Trendyol dateQueryType (see PRODUCTS_CHANGES_PHASES).
 *   page         - 0-based page index within the current phase.
 *   windowStart  - lower bound of the change window (ms epoch).
 *   windowEnd    - upper bound of the change window = the run's startedAt
 *                  (ms epoch). Always strictly after windowStart: an empty
 *                  window never gets a cursor, the run finishes instead.
 *
 * No `kind` discriminator: the dispatcher decodes by syncType and this type
 * has a single shape (it never uses Trendyol's nextPageToken).
 */
export const ProductsChangesCursorSchema = z
  .object({
    phase: z.enum(PRODUCTS_CHANGES_PHASES),
    page: z.number().int().min(0),
    windowStart: z.number().int().min(0),
    windowEnd: z.number().int().min(0),
  })
  .refine((cursor) => cursor.windowStart < cursor.windowEnd, {
    message: 'WINDOW_START_NOT_BEFORE_END',
    path: ['windowStart'],
  });
export type ProductsChangesCursor = z.infer<typeof ProductsChangesCursorSchema>;

/**
 * Parse a SyncLog.pageCursor (jsonb, possibly null) for PRODUCTS_CHANGES.
 * Returns null when the row has no cursor yet (first chunk: the handler
 * computes the window). Throws ZodError on malformed data, which takes the
 * same retryable INTERNAL_ERROR path as `parseProductsCursor`.
 */
export function parseProductsChangesCursor(raw: unknown): ProductsChangesCursor | null {
  if (raw === null || raw === undefined) return null;
  return ProductsChangesCursorSchema.parse(raw);
}

/**
 * Skip-bad-page diagnostic record. Worker writes this to
 * `SyncLog.skippedPages` (jsonb array) when MAX_ATTEMPTS is hit on a
 * `MARKETPLACE_UNREACHABLE` error and the cursor is advanced past the
 * bad page instead of terminally failing.
 *
 * `xRequestId` and `responseBodySnippet` are present only when the
 * marketplace layer captured them at exhaustion; older retries that
 * threw before the diagnostic-capture path landed will not have them.
 */
export const SkippedPageEntrySchema = z.object({
  page: z.number().int().min(0),
  attemptedAt: z.string(),
  errorCode: z.enum(SyncErrorCode),
  httpStatus: z.number().int(),
  xRequestId: z.string().optional(),
  responseBodySnippet: z.string().optional(),
});
export type SkippedPageEntry = z.infer<typeof SkippedPageEntrySchema>;

export const SkippedPageEntriesSchema = z.array(SkippedPageEntrySchema);

/**
 * Parse `SyncLog.skippedPages`. Treats null/undefined as an empty list
 * so callers don't have to special-case fresh syncs.
 */
export function parseSkippedPages(raw: unknown): SkippedPageEntry[] {
  if (raw === null || raw === undefined) return [];
  return SkippedPageEntriesSchema.parse(raw);
}
