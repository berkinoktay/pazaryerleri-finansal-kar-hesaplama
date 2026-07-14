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

import { DiscountType, DiscountValueKind } from '@pazarsync/db/enums';

import type { DiscountConfig } from '../services/discount-compute.service';

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
