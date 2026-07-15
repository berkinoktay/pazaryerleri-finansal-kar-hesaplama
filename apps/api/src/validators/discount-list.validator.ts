// Wire contract (request/response) for the İndirimler (Promosyon > İndirimler) API.
//
// Sibling of the flash/advantage/commission tariff validators. Trendyol uses the
// SAME product-selection sheet for every discount type; the discount CONFIG (type +
// its per-type parameters) lives on the PazarSync list row, not in the file. Both
// the import upload (multipart) and the config PATCH (JSON, Görev 8) carry the config
// as the SAME string fields, so a single `DiscountConfigFieldsSchema` + `refineDiscountConfig`
// is the one gate that both entry paths pass through. `discountConfigFromFields` is the
// single bridge that narrows those strings into the compute engine's `DiscountConfig`.

import { z } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import { DiscountType, DiscountValueKind } from '@pazarsync/db/enums';

import type { DiscountConfig } from '../services/discount-compute.service';
import { QuoteBreakdownSchema } from './product-pricing.validator';

// ─── Shared enums ───────────────────────────────────────────────────────────

export const DiscountTypeSchema = z.enum(DiscountType).openapi('DiscountType', {
  description:
    'İndirim kurgusu: NET / CONDITIONAL_BASKET (min sepet) / CONDITIONAL_QUANTITY (N adet) / ' +
    'BUY_X_PAY_Y / NTH_PRODUCT (X. ürüne) / CODE (indirim kodu).',
});
export const DiscountValueKindSchema = z.enum(DiscountValueKind).openapi('DiscountValueKind', {
  description: 'Değer türü: AMOUNT (TL) / PERCENT (%) / FIXED_PRICE (yalnız NTH_PRODUCT).',
});

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;
const INT_RE = /^\d+$/;

// Magnitude ceilings so an over-large config value returns a clean 422 instead of a DB numeric
// overflow: `value`/`minBasketAmount` are Decimal(12,2) (10 integer digits + 2 decimals); the
// count columns are 32-bit Int, kept comfortably below 2^31-1.
const MAX_DECIMAL_VALUE = 9999999999.99;
const MAX_INT_VALUE = 2000000000;

// The count/int config fields subject to MAX_INT_VALUE — the field name is also the issue path.
const INT_CONFIG_FIELDS = [
  'minQuantity',
  'buyQuantity',
  'payQuantity',
  'nthIndex',
  'orderLimit',
] as const;

// Multipart form her alanı STRING taşır; JSON PATCH de aynı string sözleşmesini
// kullanır ki iki giriş yolu tek doğrulayıcıdan geçsin.
export const DiscountConfigFieldsSchema = z.object({
  discountType: DiscountTypeSchema,
  valueKind: DiscountValueKindSchema.optional(),
  value: z.string().regex(DECIMAL_RE, 'INVALID_DISCOUNT_VALUE').optional(),
  minBasketAmount: z.string().regex(DECIMAL_RE, 'INVALID_MIN_BASKET').optional(),
  minQuantity: z.string().regex(INT_RE, 'INVALID_MIN_QUANTITY').optional(),
  buyQuantity: z.string().regex(INT_RE, 'INVALID_BUY_QUANTITY').optional(),
  payQuantity: z.string().regex(INT_RE, 'INVALID_PAY_QUANTITY').optional(),
  nthIndex: z.string().regex(INT_RE, 'INVALID_NTH_INDEX').optional(),
  orderLimit: z.string().regex(INT_RE, 'INVALID_ORDER_LIMIT').optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
});

export type DiscountConfigFields = z.infer<typeof DiscountConfigFieldsSchema>;

/**
 * Tür-başına zorunluluk kuralları. superRefine olarak HEM import formuna HEM config
 * PATCH gövdesine takılır — kod tabanında tek gerçek.
 */
export function refineDiscountConfig(
  val: z.infer<typeof DiscountConfigFieldsSchema>,
  ctx: z.RefinementCtx,
): void {
  const need = (field: string, code: string): void => {
    ctx.addIssue({ code: 'custom', message: code, path: [field] });
  };
  const needsValue = val.discountType !== 'BUY_X_PAY_Y';
  if (needsValue && val.value === undefined) need('value', 'VALUE_REQUIRED');
  if (needsValue && val.valueKind === undefined) need('valueKind', 'VALUE_KIND_REQUIRED');
  if (val.discountType === 'BUY_X_PAY_Y') {
    if (val.buyQuantity === undefined) need('buyQuantity', 'BUY_QUANTITY_REQUIRED');
    if (val.payQuantity === undefined) need('payQuantity', 'PAY_QUANTITY_REQUIRED');
    // The INT_RE regex accepts '0'; a pay quantity below 1 is meaningless (buy N, pay nothing).
    if (val.payQuantity !== undefined && Number(val.payQuantity) < 1) {
      need('payQuantity', 'INVALID_PAY_QUANTITY');
    }
    if (
      val.buyQuantity !== undefined &&
      val.payQuantity !== undefined &&
      Number(val.payQuantity) >= Number(val.buyQuantity)
    ) {
      need('payQuantity', 'PAY_MUST_BE_LESS_THAN_BUY');
    }
    if (val.valueKind !== undefined || val.value !== undefined) {
      need('valueKind', 'VALUE_NOT_ALLOWED');
    }
  }
  if (
    (val.discountType === 'CONDITIONAL_BASKET' || val.discountType === 'CODE') &&
    val.minBasketAmount === undefined
  ) {
    need('minBasketAmount', 'MIN_BASKET_REQUIRED');
  }
  if (val.discountType === 'CONDITIONAL_QUANTITY' && val.minQuantity === undefined) {
    need('minQuantity', 'MIN_QUANTITY_REQUIRED');
  }
  if (val.discountType === 'NTH_PRODUCT') {
    if (val.nthIndex === undefined) need('nthIndex', 'NTH_INDEX_REQUIRED');
    else {
      const n = Number(val.nthIndex);
      if (n < 2 || n > 4) need('nthIndex', 'NTH_INDEX_OUT_OF_RANGE'); // Trendyol: en fazla 4. ürün
    }
  } else if (val.valueKind === 'FIXED_PRICE') {
    need('valueKind', 'FIXED_PRICE_ONLY_FOR_NTH');
  }
  if (val.valueKind === 'PERCENT' && val.value !== undefined && Number(val.value) > 100) {
    need('value', 'PERCENT_OVER_100');
  }
  if (
    val.startsAt !== undefined &&
    val.endsAt !== undefined &&
    new Date(val.startsAt).getTime() >= new Date(val.endsAt).getTime()
  ) {
    need('endsAt', 'END_BEFORE_START');
  }
  // Magnitude bounds — a clean 422 instead of a DB numeric overflow 500 on the write.
  if (val.value !== undefined && Number(val.value) > MAX_DECIMAL_VALUE) {
    need('value', 'VALUE_TOO_LARGE');
  }
  if (val.minBasketAmount !== undefined && Number(val.minBasketAmount) > MAX_DECIMAL_VALUE) {
    need('minBasketAmount', 'MIN_BASKET_TOO_LARGE');
  }
  for (const field of INT_CONFIG_FIELDS) {
    const raw = val[field];
    if (raw !== undefined && Number(raw) > MAX_INT_VALUE) need(field, 'INT_TOO_LARGE');
  }
}

// ─── Path params ────────────────────────────────────────────────────────────

export const DiscountListStorePathSchema = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

export const DiscountListPathSchema = DiscountListStorePathSchema.extend({
  listId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'listId', in: 'path' } }),
});

export const DiscountListItemPathSchema = DiscountListPathSchema.extend({
  itemId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'itemId', in: 'path' } }),
});

// ─── Import (multipart upload) ──────────────────────────────────────────────

export const ImportDiscountListFormSchema = DiscountConfigFieldsSchema.extend({
  file: z.instanceof(File).openapi({
    type: 'string',
    format: 'binary',
    description: 'Trendyol İndirimler .xlsx (ürün seçim dosyası)',
  }),
  name: z.string().optional().openapi({ description: 'İsteğe bağlı görünen ad; yoksa dosya adı.' }),
}).superRefine(refineDiscountConfig);

export const ImportDiscountListResponseSchema = z
  .object({
    listId: z.string().uuid(),
    name: z.string(),
    itemCount: z.number().int(),
    matched: z.number().int(),
    unmatched: z.number().int(),
    skippedRows: z.number().int(),
  })
  .openapi('ImportDiscountListResponse');

export type ImportDiscountListResponse = z.infer<typeof ImportDiscountListResponseSchema>;

// ─── Config → compute bridge ────────────────────────────────────────────────

/** Doğrulanmış form/PATCH alanlarını compute'ün DiscountConfig'ine indirir. */
export function discountConfigFromFields(
  f: z.infer<typeof DiscountConfigFieldsSchema>,
): DiscountConfig {
  switch (f.discountType) {
    case 'NET':
      return { type: 'NET', valueKind: nonFixedKind(f), value: new Decimal(f.value ?? '0') };
    case 'CONDITIONAL_BASKET':
    case 'CODE':
      return {
        type: f.discountType,
        valueKind: nonFixedKind(f),
        value: new Decimal(f.value ?? '0'),
        minBasketAmount: new Decimal(f.minBasketAmount ?? '0'),
      };
    case 'CONDITIONAL_QUANTITY':
      return {
        type: 'CONDITIONAL_QUANTITY',
        valueKind: nonFixedKind(f),
        value: new Decimal(f.value ?? '0'),
        minQuantity: Number(f.minQuantity ?? '1'),
      };
    case 'BUY_X_PAY_Y':
      return {
        type: 'BUY_X_PAY_Y',
        buyQuantity: Number(f.buyQuantity ?? '1'),
        payQuantity: Number(f.payQuantity ?? '1'),
      };
    case 'NTH_PRODUCT':
      return {
        type: 'NTH_PRODUCT',
        valueKind: f.valueKind ?? 'AMOUNT',
        value: new Decimal(f.value ?? '0'),
        nthIndex: Number(f.nthIndex ?? '2'),
      };
    default: {
      const _exhaustive: never = f.discountType;
      throw new Error(`Unhandled discount type: ${String(_exhaustive)}`);
    }
  }
}

function nonFixedKind(f: z.infer<typeof DiscountConfigFieldsSchema>): 'AMOUNT' | 'PERCENT' {
  // refineDiscountConfig zaten FIXED_PRICE'ı NTH dışında reddetti; burada daralt.
  return f.valueKind === 'PERCENT' ? 'PERCENT' : 'AMOUNT';
}

/** Kaydedilmiş DiscountList satırının compute'e ilgili konfigürasyon alanları. */
export interface DiscountListConfigRow {
  discountType: DiscountType;
  valueKind: DiscountValueKind | null;
  value: Prisma.Decimal | null;
  minBasketAmount: Prisma.Decimal | null;
  minQuantity: number | null;
  buyQuantity: number | null;
  payQuantity: number | null;
  nthIndex: number | null;
}

/**
 * İkinci köprü: kaydedilmiş DiscountList satırından (Prisma) compute'ün DiscountConfig'ini
 * kurar. `discountConfigFromFields` ile TEK gerçeği paylaşır — satırın Decimal/Int
 * alanlarını string alanlara indirip aynı switch'ten geçirir (kopya switch yok). Satır
 * yazılırken (import/PATCH) `refineDiscountConfig`'ten geçtiği için burada yeniden
 * doğrulama gerekmez.
 */
export function discountConfigFromListRow(list: DiscountListConfigRow): DiscountConfig {
  return discountConfigFromFields({
    discountType: list.discountType,
    valueKind: list.valueKind ?? undefined,
    value: list.value !== null ? list.value.toString() : undefined,
    minBasketAmount: list.minBasketAmount !== null ? list.minBasketAmount.toString() : undefined,
    minQuantity: list.minQuantity !== null ? list.minQuantity.toString() : undefined,
    buyQuantity: list.buyQuantity !== null ? list.buyQuantity.toString() : undefined,
    payQuantity: list.payQuantity !== null ? list.payQuantity.toString() : undefined,
    nthIndex: list.nthIndex !== null ? list.nthIndex.toString() : undefined,
  });
}

// ─── List / detail response DTO (Görev 8) ────────────────────────────────────

// discountType..endsAt config alanları HEM liste HEM detay yanıtında birebir aynı —
// tek ortak shape'i iki şemaya da spread ederiz (kopyalama yok). Değerler wire'da
// string: para Decimal→2 hane, tarih ISO; adet alanları tamsayı.
const discountConfigShape = {
  discountType: DiscountTypeSchema,
  valueKind: DiscountValueKindSchema.nullable(),
  value: z.string().nullable(),
  minBasketAmount: z.string().nullable(),
  minQuantity: z.number().int().nullable(),
  buyQuantity: z.number().int().nullable(),
  payQuantity: z.number().int().nullable(),
  nthIndex: z.number().int().nullable(),
  orderLimit: z.number().int().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
};

export const DiscountListListItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    ...discountConfigShape,
    itemCount: z.number().int(),
    selectedCount: z.number().int(),
    exported: z.boolean(),
    updatedAt: z.string(),
  })
  .openapi('DiscountListListItem');

export const DiscountListListResponseSchema = z
  .object({ data: z.array(DiscountListListItemSchema) })
  .openapi('DiscountListListResponse');

export const DiscountCommissionSourceSchema = z
  .enum(['band', 'product', 'category'])
  .openapi('DiscountCommissionSource', {
    description:
      'Komisyon nereden geldi: komisyon tarifesi bandı (band) / ürünün senkronlanan ' +
      'komisyonu (product) / kategori oranı (category).',
  });

export const DiscountItemReasonSchema = z
  .enum(['NO_PRODUCT', 'NO_COST', 'NO_SHIPPING', 'NO_COMMISSION'])
  .openapi('DiscountItemReason', {
    description:
      'Kâr hesaplanamama nedeni: ürün eşleşmedi / maliyet yok / kargo yok / komisyon yok.',
  });

const DiscountScenarioSchema = z.object({
  price: z.string(),
  commissionPct: z.string().nullable(),
  commissionSource: DiscountCommissionSourceSchema.nullable(),
  netProfit: z.string().nullable(),
  marginPct: z.string().nullable(),
});

export const DiscountListDetailItemSchema = z
  .object({
    id: z.string().uuid(),
    barcode: z.string(),
    modelCode: z.string().nullable(),
    externalId: z.string().nullable(),
    productTitle: z.string(),
    brand: z.string().nullable(),
    color: z.string().nullable(),
    imageUrl: z.string().nullable(),
    buyboxStatus: z.string().nullable(),
    included: z.boolean(),
    calculable: z.boolean(),
    reason: DiscountItemReasonSchema.nullable(),
    current: DiscountScenarioSchema,
    discounted: DiscountScenarioSchema,
  })
  .openapi('DiscountListDetailItem');

export const DiscountListSummarySchema = z
  .object({
    itemCount: z.number().int(),
    selectedCount: z.number().int(),
    // Seçili kalemlerde sipariş başına tahmini indirim maliyeti: Σ(current.price −
    // discounted.price). Backend hesaplar — frontend yalnız render eder.
    perOrderCost: z.string(),
    // orderLimit girilmişse perOrderCost × orderLimit, yoksa null.
    maxTotalCost: z.string().nullable(),
    // Seçili + hesaplanabilir kalemlerde ortalama kâr farkı (discounted − current).
    avgProfitDelta: z.string().nullable(),
  })
  .openapi('DiscountListSummary');

export const DiscountListDetailSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    ...discountConfigShape,
    exported: z.boolean(),
    summary: DiscountListSummarySchema,
    items: z.array(DiscountListDetailItemSchema),
  })
  .openapi('DiscountListDetail');

// ─── Selections + config update body (Görev 8) ───────────────────────────────

export const DiscountSelectionSchema = z.object({
  itemId: z.string().uuid(),
  included: z.boolean(),
});

export const UpdateDiscountSelectionsBodySchema = z
  .object({
    // mode: 'set' tek tek satır günceller; 'all'/'none' TÜM listeyi işaretler/temizler
    // (500 satırlık listede tek istek — happy-path varsaymama kuralı).
    mode: z.enum(['set', 'all', 'none']).default('set'),
    selections: z.array(DiscountSelectionSchema).max(5000).default([]),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'set' && val.selections.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'SELECTIONS_REQUIRED', path: ['selections'] });
    }
  })
  .openapi('UpdateDiscountSelectionsBody');

export const UpdateDiscountSelectionsResponseSchema = z
  .object({ updated: z.number().int() })
  .openapi('UpdateDiscountSelectionsResponse');

export const UpdateDiscountListBodySchema = DiscountConfigFieldsSchema.extend({
  name: z.string().min(1).optional(),
})
  .superRefine(refineDiscountConfig)
  .openapi('UpdateDiscountListBody');

export const UpdateDiscountListResponseSchema = z
  .object({ id: z.string().uuid() })
  .openapi('UpdateDiscountListResponse');

// ─── Estimate (on-demand breakdown for a discount item) ──────────────────────
//
// The breakdown modal picks ONE of the two scenarios the detail row shows: `current`
// (the current price at its resolved commission) or `discounted` (effectiveUnitPrice at
// the commission RE-resolved on the discounted price). The service runs the SAME chain +
// engine the detail uses, so the modal never disagrees with the row.

export const EstimateDiscountItemBodySchema = z
  .object({
    scenario: z.enum(['current', 'discounted']).openapi({
      description: 'Hangi senaryonun dökümü: current (cari fiyat) / discounted (indirimli fiyat).',
    }),
  })
  .openapi('EstimateDiscountItemBody');

export const EstimateDiscountItemResultSchema = z
  .object({
    itemId: z.string().uuid(),
    scenario: z.enum(['current', 'discounted']),
    price: z.string(),
    commissionPct: z.string().nullable(),
    commissionSource: DiscountCommissionSourceSchema.nullable(),
    calculable: z.boolean(),
    reason: DiscountItemReasonSchema.nullable(),
    breakdown: QuoteBreakdownSchema.nullable(),
  })
  .openapi('EstimateDiscountItemResult');

export type EstimateDiscountItemBody = z.infer<typeof EstimateDiscountItemBodySchema>;
export type EstimateDiscountItemResult = z.infer<typeof EstimateDiscountItemResultSchema>;

// ─── Inferred TS types (consumed by the service + route layers) ──────────────

export type DiscountListListItem = z.infer<typeof DiscountListListItemSchema>;
export type DiscountListDetailItem = z.infer<typeof DiscountListDetailItemSchema>;
export type DiscountListDetail = z.infer<typeof DiscountListDetailSchema>;
export type DiscountSelection = z.infer<typeof DiscountSelectionSchema>;
export type UpdateDiscountListBody = z.infer<typeof UpdateDiscountListBodySchema>;
