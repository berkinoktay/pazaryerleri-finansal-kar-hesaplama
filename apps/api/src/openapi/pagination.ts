import { z } from "@hono/zod-openapi";
import type { ZodTypeAny } from "zod";

export const CursorMetaSchema = z
  .object({
    nextCursor: z.string().nullable().openapi({
      example:
        "eyJ2IjoxLCJzb3J0Ijoib3JkZXJfZGF0ZTpkZXNjIiwidmFsdWVzIjp7Im9yZGVyX2RhdGUiOiIyMDI2LTA0LTE1VDE0OjMwOjAwWiIsImlkIjoiYWJjLTEyMyJ9fQ",
      description: "Base64-encoded opaque cursor for the next page; null if no more results",
    }),
    hasMore: z.boolean(),
    limit: z.number().int(),
  })
  .openapi("CursorMeta");

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
