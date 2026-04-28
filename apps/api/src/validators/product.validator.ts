import { z } from '@hono/zod-openapi';

import type { Prisma, SyncLog } from '@pazarsync/db';

import { TableMetaSchema, TablePaginationQuerySchema } from '../openapi';

// ─── Sync trigger response ─────────────────────────────────────────────
// Returned from POST /v1/organizations/:orgId/stores/:storeId/products/sync
// immediately after the PENDING SyncLog row is inserted. The dedicated
// sync-worker process picks the row up via tryClaimNext (typically within
// ~1 s) and transitions it to RUNNING; clients track progress via polling
// the SyncLog endpoint or via Supabase Realtime postgres_changes.

export const StartSyncResponseSchema = z
  .object({
    syncLogId: z.string().uuid().openapi({ example: '7f3a9b2e-4d6c-48a1-9f0e-2b5c8d1a4e6f' }),
    status: z.literal('PENDING').openapi({ example: 'PENDING' }),
    enqueuedAt: z.string().datetime().openapi({ example: '2026-04-27T14:23:11.482Z' }),
  })
  .openapi('StartSyncResponse');

// ─── SyncLog response ──────────────────────────────────────────────────
// Public representation of a sync_logs row. Generic across SyncType so the
// same endpoint serves orders/settlements when those land. `progressTotal`
// is null until the first Trendyol page returns `totalElements`.

export const SyncLogResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '7f3a9b2e-4d6c-48a1-9f0e-2b5c8d1a4e6f' }),
    storeId: z
      .string()
      .uuid()
      .openapi({
        example: '1c1b9b3a-4f2d-49a8-9c5e-3a2f1d8b9c0e',
        description:
          'Store the sync belongs to. Required by the org-scoped sync-logs endpoint so the ' +
          'dashboard SyncCenter can group rows by store; redundant on store-scoped endpoints ' +
          'where the caller already knows the storeId from the URL.',
      }),
    syncType: z.enum(['ORDERS', 'PRODUCTS', 'SETTLEMENTS']).openapi({ example: 'PRODUCTS' }),
    status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'FAILED_RETRYABLE']).openapi({
      example: 'RUNNING',
      description:
        'SyncLog state. PENDING and FAILED_RETRYABLE are reserved for the worker-based ' +
        'pipeline (see docs/plans/2026-04-27-sync-engine-architecture-implementation.md) ' +
        'and never appear on the wire today; existing flows emit RUNNING / COMPLETED / FAILED.',
    }),
    startedAt: z.string().datetime().openapi({ example: '2026-04-27T14:23:11.482Z' }),
    completedAt: z.string().datetime().nullable().openapi({ example: null }),
    recordsProcessed: z.number().int().nonnegative().openapi({ example: 234 }),
    progressCurrent: z.number().int().nonnegative().openapi({ example: 234 }),
    progressTotal: z.number().int().nonnegative().nullable().openapi({ example: 1200 }),
    progressStage: z.string().nullable().openapi({ example: 'upserting' }),
    errorCode: z.string().nullable().openapi({ example: null }),
    errorMessage: z.string().nullable().openapi({ example: null }),
    attemptCount: z
      .number()
      .int()
      .nonnegative()
      .openapi({
        example: 0,
        description:
          'Number of worker claim attempts so far. 0 until the worker first claims; ' +
          'incremented on every (re)claim. Surfaced so the SyncCenter can show ' +
          '"Deneme N." for FAILED_RETRYABLE rows in backoff.',
      }),
    nextAttemptAt: z
      .string()
      .datetime()
      .nullable()
      .openapi({
        example: null,
        description:
          'When the next worker re-claim will fire for FAILED_RETRYABLE rows. ' +
          'Null on every other status. Drives the "Yeniden denenecek HH:MM" countdown ' +
          'in the SyncCenter retry section.',
      }),
  })
  .openapi('SyncLogResponse', {
    description:
      'Generic sync_logs row representation. Used by the SyncCenter UI to render ' +
      'live progress for any active sync (PRODUCTS today, ORDERS / SETTLEMENTS later).',
  });

export const SyncLogListResponseSchema = z
  .object({
    data: z.array(SyncLogResponseSchema),
  })
  .openapi('SyncLogListResponse', {
    description:
      'Active + recent sync logs for a store, ordered: every RUNNING row first, then ' +
      'the most-recent N completed/failed rows. Used to hydrate the SyncCenter UI ' +
      'before the Realtime channel takes over.',
  });

// ─── Product list query + response ─────────────────────────────────────
// Search across product title + productMainId + variant.barcode +
// variant.stockCode (Plain ILIKE for v1; pg_trgm if seller datasets ever
// exceed ~10k variants — see decision D-search in the plan doc).
//
// `status` applies at the variant level: parent included if ≥1 variant
// matches, and the variants[] in the response is filtered to matching
// variants (so an `archived` filter doesn't show a parent's onSale
// variants alongside the archived ones in the expanded view).

export const PRODUCT_VARIANT_STATUSES = ['onSale', 'archived', 'locked', 'blacklisted'] as const;
export type ProductVariantStatus = (typeof PRODUCT_VARIANT_STATUSES)[number];

export const PRODUCT_LIST_SORTS = [
  '-platformModifiedAt',
  'platformModifiedAt',
  'title',
  '-title',
] as const;
export type ProductListSort = (typeof PRODUCT_LIST_SORTS)[number];

export const ListProductsQuerySchema = TablePaginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .openapi({
      description:
        'Search across Product.title, Product.productMainId, ProductVariant.barcode, and ' +
        'ProductVariant.stockCode (case-insensitive substring match).',
      example: 'keten',
    }),
  status: z
    .enum(PRODUCT_VARIANT_STATUSES)
    .optional()
    .openapi({
      description:
        'Variant-level status filter. The parent is included if at least one variant matches; ' +
        'the variants[] array in the response is filtered to only matching variants.',
      example: 'onSale',
    }),
  brandId: z.coerce.bigint().optional().openapi({
    description: 'Trendyol brand id (BigInt) — exact match against Product.brandId.',
    example: '2032',
  }),
  categoryId: z.coerce.bigint().optional().openapi({
    description: 'Trendyol category id (BigInt) — exact match against Product.categoryId.',
    example: '2122',
  }),
  sort: z.enum(PRODUCT_LIST_SORTS).default('-platformModifiedAt').openapi({
    description: 'Sort key. Prefix with `-` for descending. Default: most-recently-modified first.',
    example: '-platformModifiedAt',
  }),
}).openapi('ListProductsQuery');

export type ListProductsQuery = z.infer<typeof ListProductsQuerySchema>;

const VariantStatusSchema = z
  .enum(['onSale', 'archived', 'locked', 'blacklisted', 'inactive'])
  .openapi({
    description:
      'Computed status from variant flags. Order of precedence: archived → blacklisted → locked → onSale → inactive.',
  });

const ProductImageSchema = z
  .object({
    id: z.string().uuid(),
    url: z.string().url(),
    position: z.number().int().nonnegative(),
  })
  .openapi('ProductImage');

const VariantSummarySchema = z
  .object({
    id: z.string().uuid(),
    platformVariantId: z.string().openapi({
      description: 'Trendyol variantId, serialized as string (BigInt).',
      example: '70228905',
    }),
    barcode: z.string(),
    stockCode: z.string(),
    size: z.string().nullable(),
    salePrice: z.string().openapi({ description: 'Decimal string', example: '199.90' }),
    listPrice: z.string().openapi({ description: 'Decimal string', example: '249.90' }),
    vatRate: z.number().int().nullable(),
    costPrice: z.string().nullable().openapi({ description: 'Decimal string, user-entered' }),
    quantity: z.number().int().nonnegative(),
    deliveryDuration: z.number().int().nullable(),
    isRushDelivery: z.boolean(),
    fastDeliveryOptions: z.array(
      z.object({
        deliveryOptionType: z.string(),
        deliveryDailyCutOffHour: z.string(),
      }),
    ),
    productUrl: z.string().nullable(),
    locationBasedDelivery: z.string().nullable(),
    status: VariantStatusSchema,
  })
  .openapi('VariantSummary');

export const ProductWithVariantsSchema = z
  .object({
    id: z.string().uuid(),
    productMainId: z.string(),
    platformContentId: z.string().openapi({
      description: 'Trendyol contentId, serialized as string (BigInt).',
      example: '12715815',
    }),
    title: z.string(),
    description: z.string().nullable(),
    brand: z.object({
      id: z.string().nullable().openapi({ example: '2032' }),
      name: z.string().nullable().openapi({ example: 'Modline' }),
    }),
    category: z.object({
      id: z.string().nullable().openapi({ example: '2122' }),
      name: z.string().nullable().openapi({ example: 'Dolap ve Gardrop' }),
    }),
    color: z.string().nullable(),
    images: z.array(ProductImageSchema),
    variantCount: z.number().int().nonnegative(),
    variants: z.array(VariantSummarySchema).openapi({
      description: 'Filtered to variants matching the `status` query param when one is supplied.',
    }),
    lastSyncedAt: z.string().datetime(),
    platformModifiedAt: z.string().datetime().nullable(),
  })
  .openapi('ProductWithVariants');

export const ListProductsResponseSchema = z
  .object({
    data: z.array(ProductWithVariantsSchema),
    pagination: TableMetaSchema,
  })
  .openapi('ListProductsResponse');

// ─── Facets endpoint ───────────────────────────────────────────────────
// Cheap GROUP BY queries — distinct brand / category values from the
// store's synced Product rows, with counts. Used to populate the toolbar
// dropdowns in PR 4.

const FacetEntrySchema = z.object({
  id: z.string().openapi({ description: 'BigInt as string', example: '2032' }),
  name: z.string().openapi({ example: 'Modline' }),
  count: z.number().int().nonnegative().openapi({ example: 47 }),
});

export const ProductFacetsResponseSchema = z
  .object({
    brands: z.array(FacetEntrySchema),
    categories: z.array(FacetEntrySchema),
  })
  .openapi('ProductFacetsResponse');

// ─── Mappers ───────────────────────────────────────────────────────────
// These convert Prisma rows (with BigInt + Decimal) into the public
// JSON shape (everything as strings). Centralised here so the route
// handler stays thin and wire-shape changes have one source of truth.

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: { variants: true; images: true };
}>;

type VariantRow = ProductWithRelations['variants'][number];

function computeVariantStatus(variant: VariantRow): z.infer<typeof VariantStatusSchema> {
  if (variant.archived) return 'archived';
  if (variant.blacklisted) return 'blacklisted';
  if (variant.locked) return 'locked';
  if (variant.onSale) return 'onSale';
  return 'inactive';
}

export function toVariantSummary(variant: VariantRow): z.infer<typeof VariantSummarySchema> {
  return {
    id: variant.id,
    platformVariantId: variant.platformVariantId.toString(),
    barcode: variant.barcode,
    stockCode: variant.stockCode,
    size: variant.size,
    salePrice: variant.salePrice.toString(),
    listPrice: variant.listPrice.toString(),
    vatRate: variant.vatRate,
    costPrice: variant.costPrice !== null ? variant.costPrice.toString() : null,
    quantity: variant.quantity,
    deliveryDuration: variant.deliveryDuration,
    isRushDelivery: variant.isRushDelivery,
    fastDeliveryOptions: Array.isArray(variant.fastDeliveryOptions)
      ? (variant.fastDeliveryOptions as {
          deliveryOptionType: string;
          deliveryDailyCutOffHour: string;
        }[])
      : [],
    productUrl: variant.productUrl,
    locationBasedDelivery: variant.locationBasedDelivery,
    status: computeVariantStatus(variant),
  };
}

export function toProductWithVariantsResponse(
  product: ProductWithRelations,
  totalVariantCount: number,
): z.infer<typeof ProductWithVariantsSchema> {
  return {
    id: product.id,
    productMainId: product.productMainId,
    platformContentId: product.platformContentId.toString(),
    title: product.title,
    description: product.description,
    brand: {
      id: product.brandId !== null ? product.brandId.toString() : null,
      name: product.brandName,
    },
    category: {
      id: product.categoryId !== null ? product.categoryId.toString() : null,
      name: product.categoryName,
    },
    color: product.color,
    images: product.images
      .sort((a, b) => a.position - b.position)
      .map((img) => ({ id: img.id, url: img.url, position: img.position })),
    variantCount: totalVariantCount,
    variants: product.variants.map(toVariantSummary),
    lastSyncedAt: product.lastSyncedAt.toISOString(),
    platformModifiedAt: product.platformModifiedAt?.toISOString() ?? null,
  };
}

// ─── Mapper: Prisma row → SyncLogResponseSchema-compatible JSON ────────
// Keeps the ISO-8601 conversions in one place — services return Prisma
// rows, route handlers serialize via this helper.

export function toSyncLogResponse(row: SyncLog): {
  id: string;
  storeId: string;
  syncType: SyncLog['syncType'];
  status: SyncLog['status'];
  startedAt: string;
  completedAt: string | null;
  recordsProcessed: number;
  progressCurrent: number;
  progressTotal: number | null;
  progressStage: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
} {
  return {
    id: row.id,
    storeId: row.storeId,
    syncType: row.syncType,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    recordsProcessed: row.recordsProcessed,
    progressCurrent: row.progressCurrent,
    progressTotal: row.progressTotal,
    progressStage: row.progressStage,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    attemptCount: row.attemptCount,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
  };
}
