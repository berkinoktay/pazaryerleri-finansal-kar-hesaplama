// Wire contract (request/response) for the saved Plus Commission Tariffs API.
//
// Sibling of `commission-tariff.validator.ts` but simpler: the Trendyol "Plus
// Komisyon" Excel is per-product a SINGLE 7-day period + a SINGLE reduced
// commission offer, so there is no band ladder and no period nesting. Each item
// carries a CURRENT scenario (current price @ current commission) and a PLUS
// scenario (the Plus price ceiling @ the reduced Plus commission), both computed
// on read by the profit engine. The seller opts each product into Plus (a
// boolean), optionally overriding the Plus price. Money is always a GROSS decimal
// STRING; the frontend renders, never computes.

import { z } from '@hono/zod-openapi';

import { QuoteBreakdownSchema } from './product-pricing.validator';

// ─── Shared enums ───────────────────────────────────────────────────────────

export const PlusTariffValiditySchema = z
  .enum(['active', 'upcoming', 'past'])
  .openapi('PlusTariffValidity', {
    description: 'Dönem geçerliliği — tarihler parse edilemezse null.',
  });

export const PlusTariffItemReasonSchema = z
  .enum(['NO_PRODUCT', 'NO_COST', 'NO_SHIPPING'])
  .openapi('PlusTariffItemReason', {
    description: 'Kâr hesaplanamama nedeni: ürün eşleşmedi / maliyet yok / kargo yok.',
  });

// ─── Path params ────────────────────────────────────────────────────────────

export const PlusTariffStorePathSchema = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

export const PlusTariffIdPathSchema = PlusTariffStorePathSchema.extend({
  tariffId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'tariffId', in: 'path' } }),
});

export const PlusTariffItemIdPathSchema = PlusTariffIdPathSchema.extend({
  itemId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'itemId', in: 'path' } }),
});

// ─── List ───────────────────────────────────────────────────────────────────

export const PlusTariffListItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    productCount: z.number().int(),
    /** How many products the seller has opted into Plus. */
    selectedCount: z.number().int(),
    exported: z.boolean(),
    validity: PlusTariffValiditySchema.nullable(),
    updatedAt: z.string().datetime(),
  })
  .openapi('PlusTariffListItem');

export const PlusTariffListResponseSchema = z
  .object({ data: z.array(PlusTariffListItemSchema) })
  .openapi('PlusTariffListResponse');

// ─── Detail (with computed current-vs-Plus profit) ──────────────────────────

// One profit scenario: the net profit + sale margin at a given gross price under
// a given commission percent. Nulls when the item is not calculable.
export const PlusScenarioSchema = z
  .object({
    /** Gross sale price (TRY) this scenario is computed at. */
    price: z.string(),
    /** Commission PERCENT as stored (e.g. "19", "15.4"). */
    commissionPct: z.string(),
    netProfit: z.string().nullable(),
    marginPct: z.string().nullable(),
  })
  .openapi('PlusScenario');

export const PlusTariffDetailItemSchema = z
  .object({
    id: z.string().uuid(),
    barcode: z.string(),
    stockCode: z.string().nullable(),
    productTitle: z.string(),
    imageUrl: z
      .string()
      .nullable()
      .openapi({ description: 'Barkod-eşleşen ürünün birincil görseli; eşleşme yoksa null.' }),
    category: z.string().nullable(),
    brand: z.string().nullable(),
    calculable: z.boolean(),
    reason: PlusTariffItemReasonSchema.nullable(),
    /** Current price @ current commission (the seller's status quo). */
    current: PlusScenarioSchema,
    /** Plus price ceiling @ reduced Plus commission (the offer). */
    plus: PlusScenarioSchema,
    /** True when the Plus scenario nets more profit than the current one. */
    plusIsBetter: z.boolean(),
    /** Seller's opt-in: has this product been joined to Plus. */
    selected: z.boolean(),
    /** Optional seller override of the Plus price (what-if); null = the ceiling. */
    customPrice: z.string().nullable(),
  })
  .openapi('PlusTariffDetailItem');

export const PlusTariffDetailSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    dateRangeLabel: z.string(),
    validity: PlusTariffValiditySchema.nullable(),
    exported: z.boolean(),
    items: z.array(PlusTariffDetailItemSchema),
  })
  .openapi('PlusTariffDetail');

// ─── Import (multipart upload) ──────────────────────────────────────────────

export const ImportPlusTariffFormSchema = z.object({
  file: z
    .instanceof(File)
    .openapi({ type: 'string', format: 'binary', description: 'Trendyol Plus komisyon .xlsx' }),
  name: z.string().optional().openapi({ description: 'İsteğe bağlı görünen ad; yoksa dosya adı.' }),
});

export const ImportPlusTariffResponseSchema = z
  .object({
    tariffId: z.string().uuid(),
    productCount: z.number().int(),
    itemCount: z.number().int(),
    matched: z.number().int(),
    unmatched: z.number().int(),
    skippedRows: z.number().int(),
  })
  .openapi('ImportPlusTariffResponse');

export type ImportPlusTariffResponse = z.infer<typeof ImportPlusTariffResponseSchema>;

// ─── Selections (Plus opt-in + optional custom price) ───────────────────────

export const PlusTariffSelectionSchema = z.object({
  itemId: z.string().uuid(),
  /** Join this product to Plus (true) or leave it out (false). */
  selected: z.boolean(),
  customPrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'INVALID_CUSTOM_PRICE')
    .nullable(),
});

export const UpdatePlusSelectionsBodySchema = z
  .object({
    selections: z.array(PlusTariffSelectionSchema).min(1).max(5000),
  })
  .openapi('UpdatePlusSelectionsBody');

export const UpdatePlusSelectionsResponseSchema = z
  .object({ updated: z.number().int() })
  .openapi('UpdatePlusSelectionsResponse');

export type PlusTariffSelection = z.infer<typeof PlusTariffSelectionSchema>;

// ─── Estimate (on-demand breakdown at an arbitrary Plus price) ──────────────
//
// The custom-price what-if: the full profit breakdown at an arbitrary price under
// the commission the `scenario` field selects — 'current' (the seller's current
// rate) or 'plus' (the reduced Plus rate, the default). The detail already carries
// both computed scenarios, so this exists only for the seller's free-form what-if.
// The breakdown is the SAME shape the Ürün Fiyatlandırma quote returns.

export const EstimatePlusPriceBodySchema = z
  .object({
    price: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'INVALID_CUSTOM_PRICE')
      .openapi({
        description: 'Değerlendirilecek satış fiyatı (GROSS, TL).',
        example: '350.00',
      }),
    scenario: z
      .enum(['current', 'plus'])
      .optional()
      .openapi({
        description:
          "Dökümün hesaplanacağı komisyon senaryosu: 'current' (güncel komisyon) ya da " +
          "'plus' (indirimli Plus komisyonu, varsayılan).",
      }),
  })
  .openapi('EstimatePlusPriceBody');

export const EstimatePlusPriceResultSchema = z
  .object({
    itemId: z.string().uuid(),
    price: z.string(),
    commissionPct: z.string().nullable(),
    calculable: z.boolean(),
    reason: PlusTariffItemReasonSchema.nullable(),
    breakdown: QuoteBreakdownSchema.nullable(),
  })
  .openapi('EstimatePlusPriceResult');

export type EstimatePlusPriceBody = z.infer<typeof EstimatePlusPriceBodySchema>;
export type EstimatePlusPriceResult = z.infer<typeof EstimatePlusPriceResultSchema>;

// ─── Inferred TS types (consumed by the service layer) ──────────────────────

export type PlusTariffListItem = z.infer<typeof PlusTariffListItemSchema>;
export type PlusScenario = z.infer<typeof PlusScenarioSchema>;
export type PlusTariffDetailItem = z.infer<typeof PlusTariffDetailItemSchema>;
export type PlusTariffDetail = z.infer<typeof PlusTariffDetailSchema>;
