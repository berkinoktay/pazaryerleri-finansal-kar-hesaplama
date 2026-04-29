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
 * Throws ZodError if the column holds malformed data — that's a sync
 * the worker should mark FAILED ('CORRUPT_CHECKPOINT').
 */
export function parseProductsCursor(raw: unknown): ProductsCursor | null {
  if (raw === null || raw === undefined) return null;
  return ProductsCursorSchema.parse(raw);
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
