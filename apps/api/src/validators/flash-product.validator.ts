// Wire contract (request/response) for the Flash Products (Flaş Ürünler) API.
//
// Sibling of the commission/plus/advantage tariff validators. This first slice
// covered the import upload; detail/list/selections/estimate follow here.
// The ONE structural difference of this vertical: a row carries up to two flash
// OFFERS (a 24-hour window and a 3-hour window), each with its own price + window
// dates, and the reduced commission is READ from the store's Commission Tariff at
// compute time (the offer's window resolves into a commission band; else the flat
// "Mevcut Komisyon" rate — no category fallback). Money is always a GROSS decimal
// STRING; the frontend renders, never computes.

import { z } from '@hono/zod-openapi';

import { QuoteBreakdownSchema } from './product-pricing.validator';

// ─── Shared enums ───────────────────────────────────────────────────────────

export const FlashOfferTypeSchema = z.enum(['H24', 'H3']).openapi('FlashOfferType', {
  description: 'Seçilen flaş penceresi: H24 = 24 Saatlik, H3 = 3 Saatlik.',
});

export const FlashItemReasonSchema = z
  .enum(['NO_PRODUCT', 'NO_COST', 'NO_SHIPPING'])
  .openapi('FlashItemReason', {
    description: 'Kâr hesaplanamama nedeni: ürün eşleşmedi / maliyet yok / kargo yok.',
  });

export const FlashCommissionSourceSchema = z
  .enum(['band', 'current'])
  .openapi('FlashCommissionSource', {
    description:
      'Komisyon nereden geldi: komisyon tarifesi bandı (band) / düz "Mevcut Komisyon" oranı (current).',
  });

export const FlashValiditySchema = z.enum(['active', 'upcoming', 'past']).openapi('FlashValidity', {
  description: 'Flaş penceresinin durumu: aktif / yaklaşan / geçmiş.',
});

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

export const FlashProductListPathSchema = FlashProductStorePathSchema.extend({
  listId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'listId', in: 'path' } }),
});

export const FlashProductItemPathSchema = FlashProductListPathSchema.extend({
  itemId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'itemId', in: 'path' } }),
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

// ─── List ───────────────────────────────────────────────────────────────────

export const FlashProductListItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    /** Distinct barcodes in the list (the same product spans several date rows). */
    productCount: z.number().int(),
    /** One item per offer row. */
    itemCount: z.number().int(),
    /** Rows with a chosen offer OR a custom price. */
    selectedCount: z.number().int(),
    exported: z.boolean(),
    updatedAt: z.string().datetime(),
  })
  .openapi('FlashProductListItem');

export const FlashProductListResponseSchema = z
  .object({ data: z.array(FlashProductListItemSchema) })
  .openapi('FlashProductListResponse');

// ─── Detail (with computed profit per scenario) ─────────────────────────────

export const FlashCommissionBandSchema = z
  .object({
    /** Lower price bound (GROSS TRY); null on the lowest band (open-ended below). */
    lowerLimit: z.string().nullable(),
    /** Upper price bound (GROSS TRY); null on the top band (open-ended above). */
    upperLimit: z.string().nullable(),
    /** The band's commission PERCENT (e.g. "13.1000"), at 4-decimal precision. */
    commissionPct: z.string(),
  })
  .openapi('FlashCommissionBand', {
    description:
      'Ürünün komisyon tarifesindeki bir fiyat bandı: [lowerLimit, upperLimit] penceresi ' +
      've o pencereye düşen komisyon oranı.',
  });

export const FlashOfferSchema = z
  .object({
    /** Offer price (GROSS TRY) Trendyol proposes for this window. */
    price: z.string(),
    startsAt: z.string().datetime().nullable(),
    endsAt: z.string().datetime().nullable(),
    validity: FlashValiditySchema.nullable(),
    /** Reduced commission PERCENT applied at this offer (band, else the flat rate). */
    commissionPct: z.string(),
    netProfit: z.string().nullable(),
    marginPct: z.string().nullable(),
  })
  .openapi('FlashOffer');

export const FlashProductDetailItemSchema = z
  .object({
    id: z.string().uuid(),
    barcode: z.string(),
    modelCode: z.string().nullable(),
    productTitle: z.string(),
    imageUrl: z
      .string()
      .nullable()
      .openapi({ description: 'Barkod-eşleşen ürünün birincil görseli; eşleşme yoksa null.' }),
    category: z.string().nullable(),
    brand: z.string().nullable(),
    stock: z.number().int().nullable(),
    externalId: z.string().nullable(),
    currentPrice: z.string(),
    customerPrice: z.string(),
    /** "Mevcut Komisyon" (I) PERCENT — the flat fallback + the current-scenario rate. */
    currentCommissionPct: z.string(),
    /** Current-scenario (customerPrice @ currentCommissionPct) profit; null when not calculable. */
    currentNetProfit: z.string().nullable(),
    currentMarginPct: z.string().nullable(),
    calculable: z.boolean(),
    reason: FlashItemReasonSchema.nullable(),
    /** Whether Trendyol flagged a commission tariff for this product ("Var"). */
    hasCommissionTariff: z.boolean(),
    /** Whether the primary window resolved to a band ladder (band) or the flat rate (current). */
    commissionSource: FlashCommissionSourceSchema,
    /**
     * The primary window's commission-band ladder (top-down). Lets the UI show WHICH
     * band a price lands in. Null when the item fell back to the flat rate (no covering
     * band).
     */
    commissionBands: z.array(FlashCommissionBandSchema).nullable(),
    /** The 24-hour offer, or null when this row carries none. */
    offer24: FlashOfferSchema.nullable(),
    /** The 3-hour offer, or null when this row carries none. */
    offer3: FlashOfferSchema.nullable(),
    /** The seller's chosen offer, or null. */
    selectedOffer: FlashOfferTypeSchema.nullable(),
    /** Optional seller custom price (what-if); null when none. */
    customPrice: z.string().nullable(),
  })
  .openapi('FlashProductDetailItem');

export const FlashProductDetailSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    exported: z.boolean(),
    items: z.array(FlashProductDetailItemSchema),
  })
  .openapi('FlashProductDetail');

// ─── Selections (chosen offer XOR custom price) ─────────────────────────────

export const FlashSelectionSchema = z.object({
  itemId: z.string().uuid(),
  /** The chosen flash window, or null to clear / when a custom price is set instead. */
  offer: FlashOfferTypeSchema.nullable(),
  customPrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'INVALID_CUSTOM_PRICE')
    .nullable(),
});

export const UpdateFlashSelectionsBodySchema = z
  .object({
    selections: z.array(FlashSelectionSchema).min(1).max(5000),
  })
  .openapi('UpdateFlashSelectionsBody');

export const UpdateFlashSelectionsResponseSchema = z
  .object({ updated: z.number().int() })
  .openapi('UpdateFlashSelectionsResponse');

export type FlashSelection = z.infer<typeof FlashSelectionSchema>;

// ─── Estimate (on-demand breakdown for a flash item) ────────────────────────
//
// Two modes, both on-demand so the detail payload stays light:
//   1. Custom-price what-if — pass a `price`; the reduced commission is resolved from
//      the band that price lands in (of the item's primary window), else the flat rate.
//   2. Current scenario (`scenario: 'current'`) — pass no price; the item's own
//      customer price at its current commission is used, so the breakdown matches the
//      detail row's current baseline byte-for-byte.

export const EstimateFlashPriceBodySchema = z
  .object({
    price: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'INVALID_CUSTOM_PRICE')
      .optional()
      .openapi({ description: 'Değerlendirilecek satış fiyatı (GROSS, TL).', example: '199.90' }),
    scenario: z
      .literal('current')
      .optional()
      .openapi({
        description:
          'Güncel senaryonun dökümü — item’ın müşteri fiyatı (customerPrice) + güncel ' +
          'komisyonuyla (Mevcut Komisyon) hesaplanır; price verilmez.',
      }),
  })
  .superRefine((val, ctx) => {
    // `scenario: 'current'` derives BOTH the price and the commission from the item, so
    // a caller-supplied price is contradictory — reject it.
    if (val.scenario === 'current') {
      if (val.price !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'INVALID_ESTIMATE_MODE', path: ['price'] });
      }
      return;
    }
    // The custom-price what-if mode requires an explicit price.
    if (val.price === undefined) {
      ctx.addIssue({ code: 'custom', message: 'PRICE_REQUIRED', path: ['price'] });
    }
  })
  .openapi('EstimateFlashPriceBody');

export const EstimateFlashPriceResultSchema = z
  .object({
    itemId: z.string().uuid(),
    price: z.string(),
    commissionPct: z.string().nullable(),
    commissionSource: FlashCommissionSourceSchema.nullable(),
    calculable: z.boolean(),
    reason: FlashItemReasonSchema.nullable(),
    breakdown: QuoteBreakdownSchema.nullable(),
  })
  .openapi('EstimateFlashPriceResult');

export type EstimateFlashPriceBody = z.infer<typeof EstimateFlashPriceBodySchema>;
export type EstimateFlashPriceResult = z.infer<typeof EstimateFlashPriceResultSchema>;

// ─── Inferred TS types (consumed by the service layer) ──────────────────────

export type FlashProductListItem = z.infer<typeof FlashProductListItemSchema>;
export type FlashCommissionBand = z.infer<typeof FlashCommissionBandSchema>;
export type FlashOffer = z.infer<typeof FlashOfferSchema>;
export type FlashProductDetailItem = z.infer<typeof FlashProductDetailItemSchema>;
export type FlashProductDetail = z.infer<typeof FlashProductDetailSchema>;
