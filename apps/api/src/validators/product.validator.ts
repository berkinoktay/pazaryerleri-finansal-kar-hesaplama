import { z } from '@hono/zod-openapi';

import { SyncStatus, SyncType } from '@pazarsync/db';
import type { Prisma, SyncLog } from '@pazarsync/db';
import { SyncErrorCode, isSyncErrorCode } from '@pazarsync/db/enums';

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
    organizationId: z
      .string()
      .uuid()
      .openapi({
        example: 'b4e2c1a0-9d3f-47e5-8a1b-6c5d4e3f2a1b',
        description:
          "Organization the sync belongs to. Surfaced so the web client's in-memory " +
          'reconstruction of a SyncLog from a Realtime event keeps tenant identity intact ' +
          '(defense-in-depth — the Realtime channel filter already enforces it server-side, but ' +
          'the field on the wire prevents silent loss in any future refactor that changes the ' +
          'channel filter).',
      }),
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
    syncType: z.enum(SyncType).openapi({ example: 'PRODUCTS' }),
    status: z.enum(SyncStatus).openapi({
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
    errorCode: z.enum(SyncErrorCode).nullable().openapi({ example: null }),
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
    skippedPages: z
      .array(
        z.object({
          page: z.number().int().nonnegative(),
          attemptedAt: z.string().datetime(),
          errorCode: z.enum(SyncErrorCode),
          httpStatus: z.number().int(),
          xRequestId: z.string().optional(),
          responseBodySnippet: z.string().optional(),
        }),
      )
      .nullable()
      .openapi({
        example: null,
        description:
          'Pages the worker skipped after exhausting MAX_ATTEMPTS on a transient ' +
          'marketplace error (deterministic upstream 5xx on a single page). Each ' +
          'entry records the offset + diagnostic surface (X-Request-ID, body snippet) ' +
          'for support correlation. Surfaced in the SyncCenter as a "X sayfa atlandı" ' +
          'warning chip on COMPLETED rows so merchants know not all of the catalog ' +
          'made it through. Null when no pages were skipped (typical case).',
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

export const PRODUCT_OVERRIDE_MISSING = ['cost', 'vat'] as const;
export type ProductOverrideMissing = (typeof PRODUCT_OVERRIDE_MISSING)[number];

export const PRODUCT_LIST_SORTS = [
  // Default — matches the Trendyol seller-panel "Eklenme tarihi" column
  // (newest listings first). Backed by Product.platformCreatedAt, which
  // mirrors Trendyol's content.creationDate. This is the closest content-
  // level analog to Trendyol's `orderByDirection: SellerCreatedDate` API
  // parameter (Trendyol sorts variants by sellerCreatedDate; we sort
  // contents by their creationDate, which coincides with the first
  // variant's creation in the typical case).
  '-platformCreatedAt',
  'platformCreatedAt',
  '-platformModifiedAt',
  'platformModifiedAt',
  'title',
  '-title',
  'salePrice',
  '-salePrice',
  'totalStock',
  '-totalStock',
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
  overrideMissing: z
    .enum(PRODUCT_OVERRIDE_MISSING)
    .optional()
    .openapi({
      description:
        'Variant-level filter: "cost" → variants with NULL costPrice; "vat" → variants with NULL vatRate. ' +
        'Composes with the status filter via AND. Parent included if ≥1 variant matches; response variants[] ' +
        'is filtered to matching variants (consistent with status semantics).',
      example: 'cost',
    }),
  sort: z
    .enum(PRODUCT_LIST_SORTS)
    .default('-platformCreatedAt')
    .openapi({
      description:
        'Sort key. Prefix with `-` for descending. Default: `-platformCreatedAt` ' +
        '(newest listings first) — matches the Trendyol seller-panel default ordering, ' +
        'analogous to the `orderByDirection: SellerCreatedDate, DESC` parameter on ' +
        "Trendyol's /products/approved endpoint. " +
        'KNOWN LIMITATION: salePrice / -salePrice currently fall back to platformCreatedAt because ' +
        'Prisma cannot natively MAX over a decimal child relation without raw SQL or a denormalized ' +
        'column. A future PR will denormalize Product.minSalePrice / maxSalePrice and replace this fallback.',
      example: '-platformCreatedAt',
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
    variantCount: z
      .number()
      .int()
      .nonnegative()
      .openapi({
        description:
          'Number of variants in the `variants[]` array on this response. When a `status` ' +
          'filter is supplied, this matches the filtered count (e.g. `?status=onSale` returns ' +
          'only onSale variants in `variants[]` and `variantCount` mirrors that length). ' +
          "Without a status filter, it equals the product's total variant count. The contract " +
          'is intentionally "what you see is what you count" — UI can use this for the variant ' +
          'count chip, the multi-variant expand affordance, and the Beden chip overflow with no ' +
          'separate length lookup.',
      }),
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
    overrideCounts: z
      .object({
        missingCost: z.number().int().nonnegative(),
        missingVat: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .openapi({
        description:
          'Counts of products with ≥1 variant missing the corresponding override field. Used to populate ' +
          'the override-state tab badges. Computed against the unfiltered store-scoped set (does not respect ' +
          'the current q/brand/category/status filters — tabs reset to the full set when activated).',
      }),
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
    // Mirrors variants[].length on purpose — see the schema description.
    // Same source ⇒ count chip + Beden chips + expanded sub-rows can never
    // disagree.
    variantCount: product.variants.length,
    variants: product.variants.map(toVariantSummary),
    lastSyncedAt: product.lastSyncedAt.toISOString(),
    platformModifiedAt: product.platformModifiedAt?.toISOString() ?? null,
  };
}

// ─── Mapper: Prisma row → SyncLogResponseSchema-compatible JSON ────────
// Keeps the ISO-8601 conversions in one place — services return Prisma
// rows, route handlers serialize via this helper.

interface SkippedPageWire {
  page: number;
  attemptedAt: string;
  errorCode: SyncErrorCode;
  httpStatus: number;
  xRequestId?: string;
  responseBodySnippet?: string;
}

export function toSyncLogResponse(row: SyncLog): {
  id: string;
  organizationId: string;
  storeId: string;
  syncType: SyncLog['syncType'];
  status: SyncLog['status'];
  startedAt: string;
  completedAt: string | null;
  recordsProcessed: number;
  progressCurrent: number;
  progressTotal: number | null;
  progressStage: string | null;
  errorCode: SyncErrorCode | null;
  errorMessage: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  skippedPages: SkippedPageWire[] | null;
} {
  return {
    id: row.id,
    organizationId: row.organizationId,
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
    skippedPages: normalizeSkippedPages(row.skippedPages),
  };
}

/**
 * Normalize the raw Prisma JSON column into the wire shape. Validator
 * (`SyncLogResponseSchema`) is the single source of truth for what's
 * acceptable; we just shape-check here. Malformed payload (shouldn't
 * happen — only the worker writes this column) is treated as null so a
 * single bad row doesn't poison the whole sync-logs list response.
 */
function normalizeSkippedPages(raw: SyncLog['skippedPages']): SkippedPageWire[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: SkippedPageWire[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (
      typeof o['page'] !== 'number' ||
      typeof o['attemptedAt'] !== 'string' ||
      !isSyncErrorCode(o['errorCode']) ||
      typeof o['httpStatus'] !== 'number'
    ) {
      continue;
    }
    out.push({
      page: o['page'],
      attemptedAt: o['attemptedAt'],
      errorCode: o['errorCode'],
      httpStatus: o['httpStatus'],
      ...(typeof o['xRequestId'] === 'string' ? { xRequestId: o['xRequestId'] } : {}),
      ...(typeof o['responseBodySnippet'] === 'string'
        ? { responseBodySnippet: o['responseBodySnippet'] }
        : {}),
    });
  }
  return out.length > 0 ? out : null;
}
