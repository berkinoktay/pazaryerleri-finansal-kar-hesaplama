import { z } from '@hono/zod-openapi';

import { CommissionRuleKind, Platform } from '@pazarsync/db/enums';

import { TablePaginationQuerySchema, tablePaginated } from '../openapi';

// ─── Shared field schemas ────────────────────────────────────────────────────

const CommissionRuleKindSchema = z.enum(CommissionRuleKind).openapi({
  description:
    'Which family of commission rules to read. CATEGORY = kategori-only tarife; ' +
    'CATEGORY_BRAND = kategori + marka tarife. Two families never mix in a single ' +
    'page because they have different cardinality and the productCount semantics ' +
    'differ (CATEGORY = sum across brands, CATEGORY_BRAND = scoped to this brand).',
  example: 'CATEGORY',
});

const PlatformSchema = z.enum(Platform).openapi({
  description: 'Marketplace this rate row belongs to.',
  example: 'TRENDYOL',
});

const ProductScopeSchema = z.enum(['all', 'active']).openapi({
  description:
    "'all' returns every commission rate row matching the other filters. 'active' " +
    'restricts to (categoryId, brandId) combinations where the store has at least ' +
    "one approved Product with a non-archived variant. Use 'active' to render the " +
    'panel "Sattıklarım" tab.',
  example: 'all',
});

const SortSchema = z
  .enum(['category_name:asc', 'base_rate:asc', 'base_rate:desc', 'product_count:desc'])
  .openapi({
    description:
      "DB-side sort orders. 'product_count:desc' is an app-layer sort over the " +
      "pre-computed product-count map; it requires productScope='active' to bound " +
      'the in-memory set (returns 422 INVALID_SORT_FOR_SCOPE otherwise).',
    example: 'category_name:asc',
  });

// ─── List query params ───────────────────────────────────────────────────────

export const listCommissionRatesQuerySchema = z
  .object({
    ruleKind: CommissionRuleKindSchema,
    productScope: ProductScopeSchema.default('all'),
    q: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .openapi({
        description:
          'Case-insensitive substring match across categoryName, parentCategoryName, ' +
          'and brandName.',
        example: 'ayakkabı',
      }),
    sort: SortSchema.default('category_name:asc'),
  })
  .merge(
    TablePaginationQuerySchema.extend({
      perPage: TablePaginationQuerySchema.shape.perPage.default(50).openapi({
        description: 'Items per page. Locked to {10, 25, 50, 100}. Default 50.',
        example: 50,
      }),
    }),
  )
  .openapi('ListCommissionRatesQuery');

export type ListCommissionRatesQuery = z.infer<typeof listCommissionRatesQuerySchema>;

// ─── Response item ───────────────────────────────────────────────────────────

export const CommissionRateListItemSchema = z
  .object({
    id: z.string().uuid().openapi({ example: 'b4e2c1a0-9d3f-47e5-8a1b-6c5d4e3f2a1b' }),
    ruleKind: CommissionRuleKindSchema,
    platform: PlatformSchema,
    categoryId: z.string().openapi({
      description: 'Marketplace categoryId as decimal string (int64 — BigInt-safe).',
      example: '411',
    }),
    brandId: z.string().nullable().openapi({
      description: 'Marketplace brandId, decimal string. Null on CATEGORY rows.',
      example: '16',
    }),
    categoryName: z.string().openapi({ example: 'Casual Ayakkabı' }),
    parentCategoryName: z.string().nullable().openapi({
      description: 'Populated on CATEGORY rows; null on CATEGORY_BRAND.',
      example: 'Günlük Ayakkabı',
    }),
    brandName: z.string().nullable().openapi({
      description: 'Populated on CATEGORY_BRAND rows; null on CATEGORY.',
      example: 'Reebok 10',
    }),
    baseRate: z.string().openapi({
      description: 'Base commission rate as decimal string (percent, 0–999.99).',
      example: '5.00',
    }),
    paymentTermDays: z.number().int().openapi({
      description: 'Days until marketplace settles this category/brand.',
      example: 60,
    }),
    segmentOverrides: z.record(z.string(), z.string()).openapi({
      description:
        'Platform-specific segment override map (Trendyol: ka1/ka2/na1/microSegment). ' +
        'Empty object when no overrides apply. Values are decimal strings.',
      example: { ka2: '4.00' },
    }),
    productCount: z
      .number()
      .int()
      .nonnegative()
      .openapi({
        description:
          'Count of approved + non-archived products in this store matching the rule ' +
          'scope. For CATEGORY rows: across all brands. For CATEGORY_BRAND: only this ' +
          'specific (categoryId, brandId) pair.',
        example: 42,
      }),
    fetchedAt: z.string().datetime().openapi({
      description: 'When the rate row was last imported from the marketplace.',
      example: '2026-05-12T08:23:01.000Z',
    }),
  })
  .openapi('CommissionRateListItem');

export type CommissionRateListItem = z.infer<typeof CommissionRateListItemSchema>;

// ─── Paginated response ──────────────────────────────────────────────────────

export const ListCommissionRatesResponseSchema = tablePaginated(
  CommissionRateListItemSchema,
).openapi('ListCommissionRatesResponse');

export type ListCommissionRatesResponse = z.infer<typeof ListCommissionRatesResponseSchema>;
