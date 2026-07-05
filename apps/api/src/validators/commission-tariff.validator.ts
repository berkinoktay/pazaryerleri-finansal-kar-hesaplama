// Wire contract (request/response) for the saved Commission Tariffs API.
//
// Single source of truth: the service imports the inferred TS types from here, so
// the serialized shapes and the OpenAPI spec never drift. Money is always a GROSS
// (VAT-inclusive) decimal STRING; the frontend renders, never computes.

import { z } from '@hono/zod-openapi';

import { QuoteBreakdownSchema } from './product-pricing.validator';

// ─── Shared enums ───────────────────────────────────────────────────────────

export const TariffValiditySchema = z
  .enum(['active', 'upcoming', 'past'])
  .openapi('TariffValidity', {
    description: 'Dönem geçerliliği — tarihler parse edilemezse null.',
  });

// The four price bands, top-down: band1 (current tier) → band4 (lowest window).
export const TariffBandKeySchema = z.enum(['band1', 'band2', 'band3', 'band4']);

export const TariffItemReasonSchema = z
  .enum(['NO_PRODUCT', 'NO_COST', 'NO_SHIPPING'])
  .openapi('TariffItemReason', {
    description: 'Kâr hesaplanamama nedeni: ürün eşleşmedi / maliyet yok / kargo yok.',
  });

// ─── Path params ────────────────────────────────────────────────────────────

export const TariffStorePathSchema = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

export const TariffIdPathSchema = TariffStorePathSchema.extend({
  tariffId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'tariffId', in: 'path' } }),
});

// ─── List ───────────────────────────────────────────────────────────────────

export const CommissionTariffListItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    productCount: z.number().int(),
    selectedCount: z.number().int(),
    exported: z.boolean(),
    validity: TariffValiditySchema.nullable(),
    // The tariff's week window (min period start … max period end), for the Advantage
    // upload's date-based commission-source picker. Null when dates were unparseable.
    weekStartsAt: z.string().datetime().nullable(),
    weekEndsAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  })
  .openapi('CommissionTariffListItem');

export const CommissionTariffListResponseSchema = z
  .object({ data: z.array(CommissionTariffListItemSchema) })
  .openapi('CommissionTariffListResponse');

// ─── Detail (with computed per-band profit) ─────────────────────────────────

export const TariffBandResultSchema = z
  .object({
    key: z.string(),
    lowerLimit: z.string().nullable(),
    upperLimit: z.string().nullable(),
    price: z.string(),
    commissionPct: z.string(),
    netProfit: z.string().nullable(),
    marginPct: z.string().nullable(),
  })
  .openapi('TariffBandResult');

export const TariffDetailItemSchema = z
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
    currentPrice: z.string(),
    commissionBasePrice: z.string().nullable().openapi({
      description:
        'Komisyona esas fiyat (müşterinin gördüğü fiyat) — güncel kâr bu fiyattan hesaplanır; kolon öncesi eski içe aktarımlarda null.',
    }),
    currentCommissionPct: z.string(),
    currentNetProfit: z.string().nullable().openapi({
      description:
        'Komisyona esas fiyat (yoksa güncel fiyat) + güncel komisyonla net kâr; hesaplanamıyorsa null.',
    }),
    currentMarginPct: z.string().nullable(),
    calculable: z.boolean(),
    reason: TariffItemReasonSchema.nullable(),
    bestBandKey: z.string().nullable(),
    selectedBand: z.string().nullable(),
    customPrice: z.string().nullable(),
    bands: z.array(TariffBandResultSchema),
  })
  .openapi('TariffDetailItem');

export const TariffPeriodSchema = z
  .object({
    id: z.string().uuid(),
    dateRangeLabel: z.string(),
    // The N from "Tarih aralığı (N Gün)" — lets the UI label the sub-period tabs
    // "3 Gün" / "4 Gün" (vs a full-week "7 Gün"). Null if the header lacked it.
    dayCount: z.number().int().nullable(),
    validity: TariffValiditySchema.nullable(),
    items: z.array(TariffDetailItemSchema),
  })
  .openapi('TariffPeriod');

export const CommissionTariffDetailSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    exported: z.boolean(),
    periods: z.array(TariffPeriodSchema),
  })
  .openapi('CommissionTariffDetail');

// ─── Import (multipart upload) ──────────────────────────────────────────────

export const ImportTariffFormSchema = z.object({
  file: z
    .instanceof(File)
    .openapi({ type: 'string', format: 'binary', description: 'Trendyol komisyon-tarifesi .xlsx' }),
  name: z.string().optional().openapi({ description: 'İsteğe bağlı görünen ad; yoksa dosya adı.' }),
});

export const ImportTariffResponseSchema = z
  .object({
    tariffId: z.string().uuid(),
    productCount: z.number().int(),
    periodCount: z.number().int(),
    itemCount: z.number().int(),
    matched: z.number().int(),
    unmatched: z.number().int(),
    skippedRows: z.number().int(),
  })
  .openapi('ImportTariffResponse');

export type ImportTariffResponse = z.infer<typeof ImportTariffResponseSchema>;

// ─── Selections (band + custom price) ───────────────────────────────────────

export const TariffSelectionSchema = z.object({
  itemId: z.string().uuid(),
  band: TariffBandKeySchema.nullable(),
  customPrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'INVALID_CUSTOM_PRICE')
    .nullable(),
});

export const UpdateSelectionsBodySchema = z
  .object({
    selections: z.array(TariffSelectionSchema).min(1).max(5000),
  })
  .openapi('UpdateSelectionsBody');

export const UpdateSelectionsResponseSchema = z
  .object({ updated: z.number().int() })
  .openapi('UpdateSelectionsResponse');

export type TariffSelection = z.infer<typeof TariffSelectionSchema>;

// ─── Estimate (on-demand breakdown for a tariff item) ───────────────────────
//
// One endpoint serves THREE frontend needs, all on-demand so the detail payload
// stays light:
//   1. Band-click modal — pass the band's price plus its `bandKey`; that band's
//      commission is applied verbatim (exact even on touching band boundaries).
//   2. Custom-price what-if — pass only a `price`; the applicable band is derived
//      from it.
//   3. Current scenario (`scenario: 'current'`) — pass neither price nor bandKey;
//      the item's own commission-base price (or its sale price when the column is
//      absent) + current commission are used, so the breakdown matches the detail
//      row's `currentNetProfit` badge byte-for-byte.
// The full profit breakdown is the SAME shape the Ürün Fiyatlandırma quote returns.

export const TariffItemIdPathSchema = TariffIdPathSchema.extend({
  itemId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'itemId', in: 'path' } }),
});

export const EstimateItemPriceBodySchema = z
  .object({
    price: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'INVALID_CUSTOM_PRICE')
      .optional()
      .openapi({ description: 'Değerlendirilecek satış fiyatı (GROSS, TL).', example: '450.00' }),
    bandKey: TariffBandKeySchema.optional().openapi({
      description:
        'Verilirse o band’ın komisyonu birebir kullanılır (band-tıklaması). ' +
        'Yoksa fiyatın düştüğü band bulunur (özel-fiyat what-if).',
    }),
    scenario: z
      .literal('current')
      .optional()
      .openapi({
        description:
          'Güncel senaryonun dökümü — item’ın komisyona esas fiyatı (yoksa güncel fiyatı) + ' +
          'güncel komisyonuyla hesaplanır; price/bandKey verilmez.',
      }),
  })
  .superRefine((val, ctx) => {
    // `scenario: 'current'` derives BOTH the price and the commission from the item
    // itself, so a caller-supplied price or bandKey is contradictory — reject it.
    if (val.scenario === 'current') {
      if (val.price !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'INVALID_ESTIMATE_MODE', path: ['price'] });
      }
      if (val.bandKey !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'INVALID_ESTIMATE_MODE', path: ['bandKey'] });
      }
      return;
    }
    // The band-click and custom-price modes both require an explicit price.
    if (val.price === undefined) {
      ctx.addIssue({ code: 'custom', message: 'PRICE_REQUIRED', path: ['price'] });
    }
  })
  .openapi('EstimateItemPriceBody');

export const EstimateItemPriceResultSchema = z
  .object({
    itemId: z.string().uuid(),
    price: z.string(),
    bandKey: z.string().nullable(),
    commissionPct: z.string().nullable(),
    calculable: z.boolean(),
    reason: TariffItemReasonSchema.nullable(),
    breakdown: QuoteBreakdownSchema.nullable(),
  })
  .openapi('EstimateItemPriceResult');

export type EstimateItemPriceBody = z.infer<typeof EstimateItemPriceBodySchema>;
export type EstimateItemPriceResult = z.infer<typeof EstimateItemPriceResultSchema>;

// ─── Inferred TS types (consumed by the service layer) ──────────────────────

export type CommissionTariffListItem = z.infer<typeof CommissionTariffListItemSchema>;
export type TariffBandResult = z.infer<typeof TariffBandResultSchema>;
export type TariffDetailItem = z.infer<typeof TariffDetailItemSchema>;
export type TariffPeriod = z.infer<typeof TariffPeriodSchema>;
export type CommissionTariffDetail = z.infer<typeof CommissionTariffDetailSchema>;
