import { z } from 'zod';

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
