import { z } from '@hono/zod-openapi';
import type { ZodTypeAny } from 'zod';

export const CursorMetaSchema = z
  .object({
    nextCursor: z.string().nullable().openapi({
      example:
        'eyJ2IjoxLCJzb3J0Ijoib3JkZXJfZGF0ZTpkZXNjIiwidmFsdWVzIjp7Im9yZGVyX2RhdGUiOiIyMDI2LTA0LTE1VDE0OjMwOjAwWiIsImlkIjoiYWJjLTEyMyJ9fQ',
      description: 'Base64-encoded opaque cursor for the next page; null if no more results',
    }),
    hasMore: z.boolean(),
    limit: z.number().int(),
  })
  .openapi('CursorMeta');

/**
 * Build a paginated response schema for a given item type.
 *
 * Usage:
 *   const PaginatedOrders = paginated(OrderSchema).openapi("PaginatedOrders");
 */
export function paginated<T extends ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    meta: CursorMetaSchema,
  });
}

// ─── Table pagination (offset-based, 1-indexed) ────────────────────────
// Used by table-driven endpoints where the UI needs concrete page numbers
// + "go to page N" affordances (e.g. shadcn `ui/pagination`). Cursor
// pagination is preferred for streaming/infinite-scroll surfaces; this
// schema is the explicit opt-in for the offset model. perPage is locked
// to a small set so the worst-case page size is predictable for both
// the DB and the bandwidth.

export const TABLE_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

export const TablePaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).openapi({
    description: '1-indexed page number',
    example: 1,
  }),
  perPage: z.coerce
    .number()
    .int()
    .refine((n): n is (typeof TABLE_PER_PAGE_OPTIONS)[number] =>
      (TABLE_PER_PAGE_OPTIONS as readonly number[]).includes(n),
    )
    .default(25)
    .openapi({
      description: 'Items per page. Locked to {10, 25, 50, 100}.',
      example: 25,
    }),
});

export const TableMetaSchema = z
  .object({
    page: z.number().int().min(1).openapi({ example: 1 }),
    perPage: z.number().int().openapi({ example: 25 }),
    total: z.number().int().nonnegative().openapi({ example: 137 }),
    totalPages: z.number().int().nonnegative().openapi({ example: 6 }),
  })
  .openapi('TableMeta');

/**
 * Build a table-paginated response schema for a given item type.
 */
export function tablePaginated<T extends ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    pagination: TableMetaSchema,
  });
}
