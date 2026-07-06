// Wire contract (request/response) for the saved Advantage Product Labels API.
//
// Sibling of the commission/plus tariff validators, but with the ONE structural
// difference of the feature: this Excel carries NO commission and NO dates. Each
// item exposes three star tiers whose reduced commission is READ from the seller's
// Commission Tariff at compute time (a tier's target price lands into a commission
// band); when the product has no commission tariff we fall back to the category
// rate. The detail therefore also surfaces WHICH commission tariff/period supplied
// the rate (`commissionSource`) so the seller can confirm the periods align. Money
// is always a GROSS decimal STRING; the frontend renders, never computes.

import { z } from '@hono/zod-openapi';

import { QuoteBreakdownSchema } from './product-pricing.validator';

// ─── Shared enums ───────────────────────────────────────────────────────────

export const StarTierKeySchema = z.enum(['tier1', 'tier2', 'tier3']).openapi('StarTierKey', {
  description: 'Yıldız kademesi: tier1 = Avantaj, tier2 = Çok Avantaj, tier3 = Süper Avantaj.',
});

export const AdvantageTariffItemReasonSchema = z
  .enum(['NO_PRODUCT', 'NO_COST', 'NO_SHIPPING', 'NO_COMMISSION'])
  .openapi('AdvantageTariffItemReason', {
    description:
      'Kâr hesaplanamama nedeni: ürün eşleşmedi / maliyet yok / kargo yok / komisyon oranı çözülemedi.',
  });

export const CommissionSourceKindSchema = z
  .enum(['band', 'category'])
  .openapi('CommissionSourceKind', {
    description: 'Kademe komisyonu nereden geldi: komisyon tarifesi bandı / kategori oranı.',
  });

export const CommissionSourceModeSchema = z
  .enum(['pinned', 'category'])
  .openapi('CommissionSourceMode', {
    description:
      'Komisyon kaynağı: kullanıcının seçtiği komisyon tarifesi (pinned) / kategori komisyonu (category).',
  });

// ─── Path params ────────────────────────────────────────────────────────────

export const AdvantageTariffStorePathSchema = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

export const AdvantageTariffIdPathSchema = AdvantageTariffStorePathSchema.extend({
  tariffId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'tariffId', in: 'path' } }),
});

export const AdvantageTariffItemIdPathSchema = AdvantageTariffIdPathSchema.extend({
  itemId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'itemId', in: 'path' } }),
});

// ─── List ───────────────────────────────────────────────────────────────────

export const AdvantageTariffListItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    productCount: z.number().int(),
    /** How many products have a chosen tier. */
    selectedCount: z.number().int(),
    exported: z.boolean(),
    updatedAt: z.string().datetime(),
  })
  .openapi('AdvantageTariffListItem');

export const AdvantageTariffListResponseSchema = z
  .object({ data: z.array(AdvantageTariffListItemSchema) })
  .openapi('AdvantageTariffListResponse');

// ─── Detail (with computed per-tier profit) ─────────────────────────────────

export const AdvantageTierSchema = z
  .object({
    key: StarTierKeySchema,
    /** Upper price threshold (best price still earning the badge = target price). */
    upperLimit: z.string(),
    lowerLimit: z.string().nullable(),
    /** Target price this tier is computed at (= upperLimit). */
    price: z.string(),
    /** Reduced commission PERCENT applied (e.g. "13.1"); null when unresolved. */
    commissionPct: z.string().nullable(),
    commissionSource: CommissionSourceKindSchema.nullable(),
    netProfit: z.string().nullable(),
    marginPct: z.string().nullable(),
  })
  .openapi('AdvantageTier');

export const AdvantageCurrentScenarioSchema = z
  .object({
    /** Reduced commission PERCENT at the current customer price (band, else category); null when unresolved. */
    commissionPct: z.string().nullable(),
    netProfit: z.string().nullable(),
    marginPct: z.string().nullable(),
    /** True when keeping the current price is the single most-profitable (positive) option. */
    isBest: z.boolean(),
  })
  .openapi('AdvantageCurrentScenario');

export const AdvantageTariffDetailItemSchema = z
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
    size: z.string().nullable(),
    stock: z.number().int().nullable(),
    currentPrice: z.string(),
    customerPrice: z.string(),
    /** Whether Trendyol flagged a commission tariff for this product ("Var"). */
    hasCommissionTariff: z.boolean(),
    calculable: z.boolean(),
    reason: AdvantageTariffItemReasonSchema.nullable(),
    /** Profit at the current price + its resolved commission (the baseline). */
    current: AdvantageCurrentScenarioSchema,
    tiers: z.array(AdvantageTierSchema),
    /** Key of the most profitable tier, or null if none calculable. */
    bestTierKey: StarTierKeySchema.nullable(),
    /** Seller's chosen tier, or null. */
    selectedTier: StarTierKeySchema.nullable(),
    /** Optional seller override price (what-if); null = the chosen tier's threshold. */
    customPrice: z.string().nullable(),
  })
  .openapi('AdvantageTariffDetailItem');

export const AdvantageCommissionSourceSchema = z
  .object({
    tariffId: z.string().uuid(),
    tariffName: z.string(),
    /** The commission tariff period label whose bands supplied the rates. */
    periodLabel: z.string(),
    startsAt: z.string().datetime().nullable(),
    endsAt: z.string().datetime().nullable(),
  })
  .openapi('AdvantageCommissionSource');

export const AdvantageTariffDetailSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    exported: z.boolean(),
    commissionSourceMode: CommissionSourceModeSchema,
    commissionSource: AdvantageCommissionSourceSchema.nullable(),
    /**
     * True when at least one product is flagged "Var" (has a commission tariff) but
     * no matching band was found in the resolved source — drives the "upload this
     * period's Commission Excel" hybrid warning.
     */
    hasUnmatchedCommissionProducts: z.boolean(),
    items: z.array(AdvantageTariffDetailItemSchema),
  })
  .openapi('AdvantageTariffDetail');

// ─── Import (multipart upload) ──────────────────────────────────────────────

export const ImportAdvantageTariffFormSchema = z.object({
  file: z.instanceof(File).openapi({
    type: 'string',
    format: 'binary',
    description: 'Trendyol Avantajlı Ürün Etiketleri .xlsx',
  }),
  name: z.string().optional().openapi({ description: 'İsteğe bağlı görünen ad; yoksa dosya adı.' }),
  commissionSourceTariffId: z.string().optional().openapi({
    description:
      'Bu avantajlının komisyonunu okuyacağı komisyon tarifesi (hafta). Boş = kategori komisyonu.',
  }),
});

export const ImportAdvantageTariffResponseSchema = z
  .object({
    tariffId: z.string().uuid(),
    productCount: z.number().int(),
    itemCount: z.number().int(),
    matched: z.number().int(),
    unmatched: z.number().int(),
    skippedRows: z.number().int(),
  })
  .openapi('ImportAdvantageTariffResponse');

export type ImportAdvantageTariffResponse = z.infer<typeof ImportAdvantageTariffResponseSchema>;

// ─── Selections (tier choice + optional custom price) ───────────────────────

export const AdvantageTariffSelectionSchema = z.object({
  itemId: z.string().uuid(),
  /** The chosen badge tier, or null to clear the selection. */
  tier: StarTierKeySchema.nullable(),
  customPrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'INVALID_CUSTOM_PRICE')
    .nullable(),
});

export const UpdateAdvantageSelectionsBodySchema = z
  .object({
    selections: z.array(AdvantageTariffSelectionSchema).min(1).max(5000),
  })
  .openapi('UpdateAdvantageSelectionsBody');

export const UpdateAdvantageSelectionsResponseSchema = z
  .object({ updated: z.number().int() })
  .openapi('UpdateAdvantageSelectionsResponse');

export type AdvantageTariffSelection = z.infer<typeof AdvantageTariffSelectionSchema>;

// ─── Commission source switch ───────────────────────────────────────────────
//
// Pins (or clears → auto) which Commission Tariff supplies the reduced rates.

export const UpdateAdvantageCommissionSourceBodySchema = z
  .object({
    commissionSourceTariffId: z
      .string()
      .uuid()
      .nullable()
      .openapi({ description: 'Sabitlenecek komisyon tarifesi; null = otomatik (aktif dönem).' }),
  })
  .openapi('UpdateAdvantageCommissionSourceBody');

export const UpdateAdvantageCommissionSourceResponseSchema = z
  .object({ commissionSourceTariffId: z.string().uuid().nullable() })
  .openapi('UpdateAdvantageCommissionSourceResponse');

export type UpdateAdvantageCommissionSourceBody = z.infer<
  typeof UpdateAdvantageCommissionSourceBodySchema
>;

// ─── Estimate (on-demand breakdown for an advantage item) ───────────────────
//
// Two modes, both on-demand so the detail payload stays light:
//   1. Custom-price what-if — pass a `price`; the reduced commission is resolved
//      from the band that price lands in (of the store's commission tariff), else
//      the category rate.
//   2. Current scenario (`scenario: 'current'`) — pass no price; the item's own
//      customer price + its current commission (band, else category — resolved
//      exactly as the detail's `current` baseline) are used, so the breakdown
//      matches the detail row's `current.netProfit` byte-for-byte.
// The full profit breakdown is the SAME shape the Ürün Fiyatlandırma quote returns.

export const EstimateAdvantagePriceBodySchema = z
  .object({
    price: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'INVALID_CUSTOM_PRICE')
      .optional()
      .openapi({ description: 'Değerlendirilecek satış fiyatı (GROSS, TL).', example: '250.00' }),
    scenario: z
      .literal('current')
      .optional()
      .openapi({
        description:
          'Güncel senaryonun dökümü — item’ın müşteri fiyatı (customerPrice) + güncel ' +
          'komisyonuyla (banda düşen ya da kategori oranı) hesaplanır; price verilmez.',
      }),
  })
  .superRefine((val, ctx) => {
    // `scenario: 'current'` derives BOTH the price (the customer price) and the
    // commission (the item's current rate) from the item itself, so a caller-supplied
    // price is contradictory — reject it.
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
  .openapi('EstimateAdvantagePriceBody');

export const EstimateAdvantagePriceResultSchema = z
  .object({
    itemId: z.string().uuid(),
    price: z.string(),
    commissionPct: z.string().nullable(),
    commissionSource: CommissionSourceKindSchema.nullable(),
    calculable: z.boolean(),
    reason: AdvantageTariffItemReasonSchema.nullable(),
    breakdown: QuoteBreakdownSchema.nullable(),
  })
  .openapi('EstimateAdvantagePriceResult');

export type EstimateAdvantagePriceBody = z.infer<typeof EstimateAdvantagePriceBodySchema>;
export type EstimateAdvantagePriceResult = z.infer<typeof EstimateAdvantagePriceResultSchema>;

// ─── Inferred TS types (consumed by the service layer) ──────────────────────

export type StarTierKey = z.infer<typeof StarTierKeySchema>;
export type AdvantageTariffListItem = z.infer<typeof AdvantageTariffListItemSchema>;
export type AdvantageTier = z.infer<typeof AdvantageTierSchema>;
export type AdvantageTariffDetailItem = z.infer<typeof AdvantageTariffDetailItemSchema>;
export type AdvantageTariffDetail = z.infer<typeof AdvantageTariffDetailSchema>;
export type AdvantageCommissionSource = z.infer<typeof AdvantageCommissionSourceSchema>;
