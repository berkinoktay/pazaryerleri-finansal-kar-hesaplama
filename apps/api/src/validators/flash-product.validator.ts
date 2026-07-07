// Wire contract (request/response) for the Flash Products (Flaş Ürünler) API.
//
// Sibling of the commission/plus/advantage tariff validators. This first slice
// covers only the import upload; the detail/selections/estimate/export schemas
// land with their routes (see docs/plans/2026-07-07-flash-products-design.md).
// Money is always a GROSS decimal STRING; the frontend renders, never computes.

import { z } from '@hono/zod-openapi';

// ─── Path params ────────────────────────────────────────────────────────────

export const FlashProductStorePathSchema = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

// ─── Import (multipart upload) ──────────────────────────────────────────────

export const ImportFlashProductsFormSchema = z.object({
  file: z.instanceof(File).openapi({
    type: 'string',
    format: 'binary',
    description: 'Trendyol Flaş Ürünler .xlsx',
  }),
  name: z.string().optional().openapi({ description: 'İsteğe bağlı görünen ad; yoksa dosya adı.' }),
});

export const ImportFlashProductsResponseSchema = z
  .object({
    listId: z.string().uuid(),
    name: z.string(),
    productCount: z.number().int(),
    itemCount: z.number().int(),
    matched: z.number().int(),
    unmatched: z.number().int(),
    skippedRows: z.number().int(),
  })
  .openapi('ImportFlashProductsResponse');

export type ImportFlashProductsResponse = z.infer<typeof ImportFlashProductsResponseSchema>;
