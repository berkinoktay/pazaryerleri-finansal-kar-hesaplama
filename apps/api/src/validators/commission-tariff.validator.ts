// Wire contract (request/response) for the saved Commission Tariffs API.
//
// Single source of truth: the service imports the inferred TS types from here, so
// the serialized shapes and the OpenAPI spec never drift. Money is always a GROSS
// (VAT-inclusive) decimal STRING; the frontend renders, never computes.

import { z } from '@hono/zod-openapi';

import { NameSchema } from '../workbooks/form';
import { MAX_TARIFF_ITEMS } from '../workbooks/tariff-week';
import { SelectionCustomPriceSchema } from './custom-price';
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
    description:
      'Kâr hesaplanamama nedeni: ürün eşleşmedi / maliyet yok / kargo yok. reason null + ' +
      'calculable false ise kâr bu kalem için hesaplanamadı (sunucuda loglandı); satır yine de döner. ' +
      'Komisyon tarifesi satırında reason null + calculable false, fiyatı bilinmeyen satırı da kapsar ' +
      '(ne güncel fiyat ne komisyona esas fiyat biliniyor ve hiçbir fiyat aralığının fiyatı yok).',
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
    price: z
      .string()
      .nullable()
      .openapi({
        description:
          'Aralığın fiyatı (üst sınır; üst sınırı olmayan aralıkta alt sınır, hiç sınırı yoksa güncel ' +
          'fiyat). 0 olan bir sınır yok sayılır. Kullanılabilir sınırı olmayan aralıkta güncel fiyat ' +
          'bilinmiyorsa null; böyle bir aralığın kârı yoktur ve seçilemez.',
      }),
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
    currentPrice: z.string().nullable().openapi({
      description:
        'Güncel satış fiyatı (GÜNCEL TSF). Dosyadaki hücre boş, okunamaz ya da 0 ise null.',
    }),
    commissionBasePrice: z
      .string()
      .nullable()
      .openapi({
        description:
          'Komisyona esas fiyat (müşterinin gördüğü fiyat) — güncel kâr bu fiyattan hesaplanır; kolon öncesi eski içe aktarımlarda null. ' +
          'Null ise güncel kâr güncel fiyattan hesaplanır; ikisi de null ise güncel kâr hesaplanmaz.',
      }),
    currentCommissionPct: z
      .string()
      .nullable()
      .openapi({
        description:
          "The current commission percent. Null when the file's cell was blank or unreadable; " +
          'a readable 0 stays 0.',
      }),
    currentNetProfit: z
      .string()
      .nullable()
      .openapi({
        description:
          'Net profit under the current commission, computed at commissionBasePrice, else at ' +
          "currentPrice; the scenario engine applies the store's profit settings. Null when " +
          'neither price is known, the current commission is unknown, or the profit cannot be ' +
          'computed.',
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
  name: NameSchema.optional().openapi({ description: 'İsteğe bağlı görünen ad; yoksa dosya adı.' }),
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
    prefilledRows: z.number().int(),
    unknownCurrentPriceRows: z
      .number()
      .int()
      .openapi({
        description:
          'Ne güncel fiyatı (GÜNCEL TSF) ne komisyona esas fiyatı bilinen ürün satırı sayısı ' +
          '(hücre boş, okunamaz ya da 0). Bu satırların güncel kârı hesaplanmaz; sınırı olan ' +
          'aralıkların kârı hesaplanır. Her ürün satırı, dönem sayısından bağımsız olarak bir kez ' +
          'sayılır.',
      }),
    unknownCommissionRows: z
      .number()
      .int()
      .openapi({
        description:
          'The product rows whose current commission percent is unknown (the cell was blank or ' +
          'unreadable; a readable 0 is a real 0% and is not counted). Their current profit is ' +
          'unknown and never computed at 0%; the band profits are still computed. Each product ' +
          'row counts once, whatever the number of periods.',
      }),
  })
  .openapi('ImportTariffResponse');

export type ImportTariffResponse = z.infer<typeof ImportTariffResponseSchema>;

// ─── Selections (band + custom price) ───────────────────────────────────────

export const TariffSelectionSchema = z.object({
  itemId: z.string().uuid(),
  band: TariffBandKeySchema.nullable(),
  customPrice: SelectionCustomPriceSchema.nullable(),
});

export const UpdateSelectionsBodySchema = z
  .object({
    selections: z.array(TariffSelectionSchema).min(1).max(MAX_TARIFF_ITEMS),
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
//      row's `currentNetProfit` badge byte-for-byte. When neither price is known the
//      service answers 422 on `scenario` (CURRENT_PRICE_UNKNOWN); when the current
//      commission percent is unknown, 422 on `scenario` (CURRENT_COMMISSION_UNKNOWN).
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
          "Breakdown of the current scenario: priced at the item's commission base price, else " +
          'at its current price, under its current commission; send no price or bandKey. When ' +
          "neither price is known (the file's cells were blank, unreadable or 0) there is nothing " +
          'to price: 422 on `scenario` with code CURRENT_PRICE_UNKNOWN. When the current ' +
          "commission percent is unknown (the file's cell was blank or unreadable) it is not " +
          'priced at 0%: 422 on `scenario` with code CURRENT_COMMISSION_UNKNOWN. The price check ' +
          'comes first.',
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
