import { z } from '@hono/zod-openapi';

import { TablePaginationQuerySchema, tablePaginated } from '../openapi';

// ─── Shared field patterns ───────────────────────────────────────────────────

/** Decimal money string: up to 2 decimal places, may be negative. */
const moneyString = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'INVALID_MONEY_FORMAT');

/** Decimal percent string: up to 4 decimal places (margin/markup fields). */
const percentString = z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'INVALID_PERCENT_FORMAT');

// ─── Enums ───────────────────────────────────────────────────────────────────

const CostStatusSchema = z.enum(['OK', 'NO_PROFILES', 'FX_STALE', 'FX_MISSING']).openapi({
  description:
    'Cost availability for this variant. OK = profiles exist + FX resolved. ' +
    'NO_PROFILES = no cost profiles attached. FX_STALE = AUTO profile exists but ' +
    'FX rate is >2 days old. FX_MISSING = AUTO profile exists but no FX rate fetched.',
  example: 'OK',
});

const ShippingEstimateStatusSchema = z
  .enum(['OK', 'NO_CARRIER', 'NO_DESI', 'OWN_CONTRACT_EMPTY', 'DESI_OVERFLOW'])
  .openapi({
    description:
      'Shipping estimate availability. OK = estimate computed. NO_CARRIER = no carrier ' +
      'configured on this store. NO_DESI = variant has no dimensional weight. ' +
      'OWN_CONTRACT_EMPTY = own-contract store with no tariff row for this desi. ' +
      'DESI_OVERFLOW = variant desi exceeds carrier tariff coverage.',
    example: 'OK',
  });

const CommissionStatusSchema = z.enum(['OK', 'NO_RULE']).openapi({
  description:
    'Commission rule availability. OK = a matching marketplace commission rate exists. ' +
    'NO_RULE = no rule found for this category/brand combination.',
  example: 'OK',
});

/**
 * Quote-level failure reason. Superset of the engine's SolveReason — adds
 * NOT_CALCULABLE for the case where cost is OK but shipping or commission data
 * is missing, preventing the solver from being invoked at all.
 */
const QuoteReasonSchema = z
  .enum(['NOT_PRICE_SENSITIVE', 'UNREACHABLE_TARGET', 'NO_COST', 'NOT_CALCULABLE'])
  .openapi({
    description:
      'Why the price could not be solved. NOT_PRICE_SENSITIVE = net profit does not ' +
      'increase with price (commission + fees > margin). UNREACHABLE_TARGET = the ' +
      'requested margin/markup target cannot be reached at any positive price. ' +
      'NO_COST = cost is unavailable so the calculation would be incorrect. ' +
      'NOT_CALCULABLE = required cost/commission/shipping inputs are missing for this variant.',
    example: 'UNREACHABLE_TARGET',
  });

// ─── List query ──────────────────────────────────────────────────────────────

const ProductPricingSortSchema = z
  .enum([
    'salePrice:asc',
    'salePrice:desc',
    'title:asc',
    'title:desc',
    'netProfit:asc',
    'netProfit:desc',
    'saleMarginPct:asc',
    'saleMarginPct:desc',
    'costMarkupPct:asc',
    'costMarkupPct:desc',
  ])
  .openapi({
    description:
      'Sort order for the product pricing list. ' +
      'Profit/margin/markup sorts: rows where the value is null (not calculable) sort last (NULLS LAST).',
    example: 'salePrice:asc',
  });

export const ListProductPricingQuerySchema = TablePaginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .min(1, 'INVALID_SEARCH_TOO_SHORT')
    .max(200, 'INVALID_SEARCH_TOO_LONG')
    .optional()
    .openapi({
      description: 'Case-insensitive substring match across barcode, SKU, and product name.',
      example: 'Nike',
    }),
  sortBy: ProductPricingSortSchema.optional(),
  calculableOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .openapi({
      description:
        "When 'true', returns only rows where calculable=true (cost + shipping + " +
        'commission all resolved). Useful for displaying only actionable variants.',
      example: 'false',
    }),
  profitStatus: z
    .enum(['profitable', 'breakeven', 'loss', 'all'])
    .default('all')
    .optional()
    .openapi({
      description:
        'Filter by forward profit direction. ' +
        'profitable: forwardNetProfit > 0. ' +
        'breakeven: forwardNetProfit = 0. ' +
        'loss: forwardNetProfit < 0. ' +
        'all: no filter (default). ' +
        'Not-calculable rows (forwardNetProfit IS NULL) are excluded by profitable/breakeven/loss.',
      example: 'profitable',
    }),
  marginMin: z
    .string()
    .regex(/^-?\d+(\.\d{1,4})?$/, 'INVALID_MARGIN_FORMAT')
    .optional()
    .openapi({
      description:
        'Minimum sale margin % (inclusive). Negative values allowed — margins can be negative.',
      example: '15.5',
    }),
  marginMax: z
    .string()
    .regex(/^-?\d+(\.\d{1,4})?$/, 'INVALID_MARGIN_FORMAT')
    .optional()
    .openapi({
      description:
        'Maximum sale margin % (inclusive). Negative values allowed — margins can be negative.',
      example: '80',
    }),
  categoryId: z.string().regex(/^\d+$/, 'INVALID_CATEGORY_ID').optional().openapi({
    description: 'Filter by product category (bigint as string).',
    example: '12345',
  }),
  brandId: z.string().regex(/^\d+$/, 'INVALID_BRAND_ID').optional().openapi({
    description: 'Filter by product brand (bigint as string).',
    example: '67890',
  }),
}).openapi('ListProductPricingQuery');

export type ListProductPricingQuery = z.infer<typeof ListProductPricingQuerySchema>;

// ─── List item ───────────────────────────────────────────────────────────────

export const ProductPricingItemSchema = z
  .object({
    variantId: z.string().uuid().openapi({
      example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    }),
    sku: z.string().openapi({ example: 'NK-AIR-42-WHT' }),
    barcode: z.string().openapi({ example: '8680000000001' }),
    productName: z.string().openapi({ example: 'Nike Air Max 90' }),
    salePrice: moneyString.openapi({
      description: 'Current list price (GROSS, VAT-inclusive), decimal string.',
      example: '1299.90',
    }),
    costStatus: CostStatusSchema,
    shippingEstimateStatus: ShippingEstimateStatusSchema,
    commissionStatus: CommissionStatusSchema,
    calculable: z.boolean().openapi({
      description:
        'True only when costStatus, shippingEstimateStatus, and commissionStatus are all OK.',
      example: true,
    }),
    netProfit: moneyString.nullable().openapi({
      description: 'Net profit at current sale price. Null when calculable=false.',
      example: '234.56',
    }),
    saleMarginPct: percentString.nullable().openapi({
      description: 'Net profit / sale GROSS × 100. Null when calculable=false or saleGross=0.',
      example: '18.05',
    }),
    costMarkupPct: percentString.nullable().openapi({
      description: 'Net profit / cost GROSS × 100. Null when calculable=false or costGross=0.',
      example: '42.30',
    }),
    imageUrl: z.string().url().nullable().openapi({
      description: 'Primary product image URL (position=0). Null if no image is attached.',
      example: 'https://cdn.example.com/p-123.jpg',
    }),
    cost: moneyString.nullable().openapi({
      description: 'Current cost (GROSS, TRY), decimal string. Null when costStatus is not OK.',
      example: '250.00',
    }),
    categoryId: z
      .string()
      .regex(/^\d+$/)
      .nullable()
      .openapi({ description: 'Product category ID (bigint as string).', example: '12345' }),
    categoryName: z.string().nullable().openapi({ example: 'Ayakkabı' }),
    brandId: z
      .string()
      .regex(/^\d+$/)
      .nullable()
      .openapi({ description: 'Product brand ID (bigint as string).', example: '67890' }),
    brandName: z.string().nullable().openapi({ example: 'Nike' }),
  })
  .openapi('ProductPricingItem');

export type ProductPricingItem = z.infer<typeof ProductPricingItemSchema>;

// ─── List response ───────────────────────────────────────────────────────────

export const ListProductPricingResponseSchema = tablePaginated(ProductPricingItemSchema).openapi(
  'ListProductPricingResponse',
);

export type ListProductPricingResponse = z.infer<typeof ListProductPricingResponseSchema>;

// ─── Quote request ───────────────────────────────────────────────────────────

/**
 * Target value string: decimal, 0–4 decimal places, non-negative.
 * The regex disallows a leading minus sign, so negative values are rejected at
 * the pattern level. A negative margin/markup goal makes no practical sense and
 * the solver would produce a negative-price result anyway.
 */
const targetValueString = z.string().regex(/^\d+(\.\d{1,4})?$/, 'INVALID_TARGET_VALUE');

export const QuoteInputSchema = z
  .object({
    variantId: z.string().uuid('INVALID_VARIANT_ID'),
    target: z
      .object({
        type: z.enum(['margin', 'markup', 'profit'], {
          message: 'INVALID_TARGET_TYPE',
        }),
        value: targetValueString,
      })
      .openapi({
        description:
          'Pricing target to solve for. type=margin: solve for the sale price that yields ' +
          'the given net-profit / sale-GROSS percentage. type=markup: solve for the sale ' +
          'price yielding the given net-profit / cost-GROSS percentage. type=profit: solve ' +
          'for the sale price yielding the given absolute net profit (TRY).',
        example: { type: 'margin', value: '20' },
      }),
  })
  .openapi('QuoteInput');

export type QuoteInput = z.infer<typeof QuoteInputSchema>;

// ─── Quote response ───────────────────────────────────────────────────────────

const QuoteBreakdownSchema = z
  .object({
    listGross: moneyString,
    sellerDiscountGross: moneyString,
    saleGross: moneyString,
    saleVat: moneyString,
    costGross: moneyString,
    costVat: moneyString,
    commissionGross: moneyString,
    commissionVat: moneyString,
    shippingGross: moneyString,
    shippingVat: moneyString,
    platformServiceGross: moneyString,
    platformServiceVat: moneyString,
    stoppage: moneyString,
    netVat: moneyString,
    netProfit: moneyString,
    saleMarginPct: percentString.nullable().openapi({
      description: 'Null when saleGross=0.',
      example: '20.00',
    }),
    costMarkupPct: percentString.nullable().openapi({
      description: 'Null when costGross=0.',
      example: '45.00',
    }),
  })
  .openapi('QuoteBreakdown');

export const QuoteResponseSchema = z
  .object({
    variantId: z.string().uuid().openapi({
      example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    }),
    calculable: z.boolean().openapi({
      description: 'Whether the solver produced a valid price for this target.',
      example: true,
    }),
    reason: QuoteReasonSchema.optional().openapi({
      description: 'Present only when calculable=false. Explains why the price could not be found.',
    }),
    price: moneyString.optional().openapi({
      description:
        'Solved sale price (GROSS, VAT-inclusive), decimal string. Present only when calculable=true.',
      example: '1499.90',
    }),
    priceDelta: moneyString.optional().openapi({
      description:
        'Signed price change vs the current sale price (solved − current, GROSS). ' +
        'Present only when calculable=true; negative when the price drops to hit the target.',
      example: '254.90',
    }),
    breakdown: QuoteBreakdownSchema.optional().openapi({
      description: 'Full profit breakdown at the solved price. Present only when calculable=true.',
    }),
  })
  .openapi('ProductPriceQuote');

export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

// ─── Price write request ───────────────────────────────────────────────────────

/**
 * Positive GROSS (VAT-inclusive) money string: 1–2 decimals, strictly > 0.
 * The regex requires at least one non-zero digit so "0", "0.00" are rejected at
 * the pattern level — a sale price must be a positive amount.
 */
const positiveMoneyString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'INVALID_MONEY_FORMAT')
  .refine((v) => Number(v) > 0, 'INVALID_SALE_PRICE');

export const UpdatePriceInputSchema = z
  .object({
    variantId: z.string().uuid('INVALID_VARIANT_ID'),
    salePrice: positiveMoneyString.openapi({
      description:
        'New sale price to write to the marketplace (GROSS, VAT-inclusive), decimal string. ' +
        'Must be strictly positive. This is the price the product is offered at on the marketplace ' +
        'storefront (Trendyol `buyingPrice`).',
      example: '1499.90',
    }),
  })
  .openapi('UpdatePriceInput');

export type UpdatePriceInput = z.infer<typeof UpdatePriceInputSchema>;

// ─── Price write response ──────────────────────────────────────────────────────

const PriceWriteStatusSchema = z.enum(['SUCCESS', 'PENDING']).openapi({
  description:
    'Outcome of the price write. SUCCESS = the marketplace confirmed the item and the local ' +
    "sale price was updated. PENDING = the marketplace accepted the batch but didn't confirm " +
    'within the polling window — the local price was NOT updated; the change may still apply at ' +
    'the marketplace. A FAILED item does not return here — it is a 422 MARKETPLACE_WRITE_FAILED error.',
  example: 'SUCCESS',
});

export const UpdatePriceResponseSchema = z
  .object({
    status: PriceWriteStatusSchema,
    variantId: z.string().uuid().openapi({
      example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    }),
    newSalePrice: moneyString.openapi({
      description: 'The submitted sale price (GROSS, VAT-inclusive), decimal string.',
      example: '1499.90',
    }),
    batchId: z.string().openapi({
      description: 'Trendyol batch id assigned to this price update (poll target).',
      example: '57a7229a-e345-4232-88ac-f4169b864293',
    }),
  })
  .openapi('UpdatePriceResponse');

export type UpdatePriceResponse = z.infer<typeof UpdatePriceResponseSchema>;
