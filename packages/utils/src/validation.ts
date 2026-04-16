import { z } from 'zod';

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const dateRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>;
export type DateRangeInput = z.infer<typeof dateRangeSchema>;
