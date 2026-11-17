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

import { NameSchema } from '../workbooks/form';
import { MAX_TARIFF_ITEMS } from '../workbooks/tariff-week';
import { SelectionCustomPriceSchema } from './custom-price';
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
    description:
      'Why the profit could not be computed: no matching product / no cost / no shipping. ' +
      'calculable false with reason null means the profit could not be computed for this item ' +
      '(the failure was logged on the server, or the row has no known price); the row is still returned.',
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
    // The tariff's week window (min period start … max period end), parity with the
    // product commission tariff list. Null when the period dates were unparseable.
    weekStartsAt: z.string().datetime().nullable(),
    weekEndsAt: z.string().datetime().nullable(),
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
    /** Gross sale price (TRY) this scenario is computed at; null when unknown. */
    price: z
      .string()
      .nullable()
      .openapi({
        description:
          'Gross sale price (TRY) this scenario is computed at. Null when the Plus price upper ' +
          'limit is unknown; the scenario then has no profit.',
      }),
    /** Commission PERCENT as stored (e.g. "19", "15.4"); null when unknown. */
    commissionPct: z
      .string()
      .nullable()
      .openapi({
        description:
          "Commission percent this scenario is computed under. Null when the file's cell was " +
          'blank or unreadable; a readable 0 stays 0. The scenario then has no profit.',
      }),
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
    /** Güncel TSF (the seller's current sale price). */
    currentPrice: z.string().nullable().openapi({
      description:
        "The seller's current sale price. Null when the file's cell was blank, unreadable or 0.",
    }),
    /** Komisyona Esas Fiyat — the customer-seen price the current scenario is priced on. */
    commissionBasePrice: z
      .string()
      .nullable()
      .openapi({
        description:
          'The commission base price (the price the customer sees); the current profit is ' +
          "computed from it. Null when the file's cell was blank, unreadable or 0.",
      }),
    /** The current commission PERCENT; null when unknown. */
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
    /** Plus Fiyat Üst Limiti — the ceiling price to qualify for the Plus commission. */
    plusPriceUpperLimit: z
      .string()
      .nullable()
      .openapi({
        description:
          'The Plus price upper limit, the ceiling price to qualify for the Plus commission. ' +
          "Null when the file's cell was blank, unreadable or 0.",
      }),
    /** Plus price (custom, else the ceiling) @ reduced Plus commission (the offer). */
    plus: PlusScenarioSchema,
    /** True when the Plus scenario nets more profit than the current one. */
    plusIsBetter: z.boolean(),
    calculable: z.boolean(),
    reason: PlusTariffItemReasonSchema.nullable(),
    /** Seller's opt-in: has this product been joined to Plus. */
    selected: z.boolean(),
    /** Optional seller override of the Plus price (what-if); null = the ceiling. */
    customPrice: z.string().nullable(),
  })
  .openapi('PlusTariffDetailItem');

export const PlusTariffPeriodSchema = z
  .object({
    id: z.string().uuid(),
    dateRangeLabel: z.string(),
    // The N from "Tarih Aralığı (N Gün)" — lets the UI label the sub-period tabs
    // "3 Gün" / "4 Gün" (vs a full-week "7 Gün"). Null if the header lacked it.
    dayCount: z.number().int().nullable(),
    validity: PlusTariffValiditySchema.nullable(),
    items: z.array(PlusTariffDetailItemSchema),
  })
  .openapi('PlusTariffPeriod');

export const PlusTariffDetailSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    exported: z.boolean(),
    periods: z.array(PlusTariffPeriodSchema),
  })
  .openapi('PlusTariffDetail');

// ─── Import (multipart upload) ──────────────────────────────────────────────

export const ImportPlusTariffFormSchema = z.object({
  file: z
    .instanceof(File)
    .openapi({ type: 'string', format: 'binary', description: 'Trendyol Plus komisyon .xlsx' }),
  name: NameSchema.optional().openapi({ description: 'İsteğe bağlı görünen ad; yoksa dosya adı.' }),
});

export const ImportPlusTariffResponseSchema = z
  .object({
    tariffId: z.string().uuid(),
    productCount: z.number().int(),
    periodCount: z.number().int(),
    itemCount: z.number().int(),
    matched: z.number().int(),
    unmatched: z.number().int(),
    skippedRows: z.number().int(),
    prefilledRows: z.number().int(),
    unknownPriceRows: z
      .number()
      .int()
      .openapi({
        description:
          'The product rows with no baseline price (neither a commission base price nor a ' +
          'current price) or no Plus price upper limit (the cell was blank, unreadable or 0). ' +
          'Their unknown prices show as unknown and are never computed from. Each product row ' +
          'counts once, whatever the number of periods.',
      }),
    unknownCommissionRows: z
      .number()
      .int()
      .openapi({
        description:
          'The product rows with an unknown current commission percent, or with an unknown Plus ' +
          'commission offer in a stored period (the cell was blank or unreadable; a readable 0 is ' +
          'a real 0% and is not counted). The offer of a period the upload does not store is not ' +
          'read. A profit that needs an unknown percent shows as unknown and is never computed at ' +
          '0%. Each product row counts once, whatever the number of periods.',
      }),
  })
  .openapi('ImportPlusTariffResponse');

export type ImportPlusTariffResponse = z.infer<typeof ImportPlusTariffResponseSchema>;

// ─── Selections (Plus opt-in + optional custom price) ───────────────────────

export const PlusTariffSelectionSchema = z.object({
  itemId: z.string().uuid(),
  /** Join this product to Plus (true) or leave it out (false). */
  selected: z.boolean(),
  customPrice: SelectionCustomPriceSchema.nullable(),
});

export const UpdatePlusSelectionsBodySchema = z
  .object({
    selections: z.array(PlusTariffSelectionSchema).min(1).max(MAX_TARIFF_ITEMS),
  })
  .openapi('UpdatePlusSelectionsBody');

export const UpdatePlusSelectionsResponseSchema = z
  .object({ updated: z.number().int() })
  .openapi('UpdatePlusSelectionsResponse');

export type PlusTariffSelection = z.infer<typeof PlusTariffSelectionSchema>;

// ─── Estimate (on-demand breakdown for a Plus tariff item) ──────────────────
//
// One endpoint serves TWO frontend needs, both on-demand so the detail payload
// stays light:
//   1. Custom-price what-if — pass a `price`; the item's reduced Plus commission
//      is applied at it. When that Plus commission offer is unknown the service
//      answers 422 on `price` (PLUS_COMMISSION_UNKNOWN).
//   2. Current scenario (`scenario: 'current'`) — pass neither price; the item's
//      own commission-base price (or its current price when the commission-base
//      price is unknown) + current commission are used, so the breakdown matches
//      the detail row's `currentNetProfit` badge byte-for-byte. When neither price
//      is known the service answers 422 on `scenario` (CURRENT_PRICE_UNKNOWN); when
//      the current commission percent is unknown, 422 on `scenario`
//      (CURRENT_COMMISSION_UNKNOWN).
// The full profit breakdown is the SAME shape the Ürün Fiyatlandırma quote returns.

export const EstimatePlusPriceBodySchema = z
  .object({
    price: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'INVALID_CUSTOM_PRICE')
      .optional()
      .openapi({
        description:
          "Gross sale price (TRY) to price under the item's Plus commission offer. When that " +
          "offer is unknown (the file's cell was blank or unreadable) it is not priced at 0%: " +
          '422 on `price` with code PLUS_COMMISSION_UNKNOWN.',
        example: '350.00',
      }),
    scenario: z
      .literal('current')
      .optional()
      .openapi({
        description:
          "Breakdown of the current scenario: priced at the item's commission base price, else " +
          'at its current price, under its current commission; send no price. When neither ' +
          "price is known (the file's cells were blank, unreadable or 0) there is nothing to " +
          'price: 422 on `scenario` with code CURRENT_PRICE_UNKNOWN. When the current ' +
          "commission percent is unknown (the file's cell was blank or unreadable) it is not " +
          'priced at 0%: 422 on `scenario` with code CURRENT_COMMISSION_UNKNOWN. The price check ' +
          'comes first.',
      }),
  })
  .superRefine((val, ctx) => {
    // `scenario: 'current'` derives BOTH the price and the commission from the item
    // itself, so a caller-supplied price is contradictory — reject it.
    if (val.scenario === 'current') {
      if (val.price !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'INVALID_ESTIMATE_MODE', path: ['price'] });
      }
      return;
    }
    // The custom-price mode requires an explicit price.
    if (val.price === undefined) {
      ctx.addIssue({ code: 'custom', message: 'PRICE_REQUIRED', path: ['price'] });
    }
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
export type PlusTariffPeriod = z.infer<typeof PlusTariffPeriodSchema>;
export type PlusTariffDetail = z.infer<typeof PlusTariffDetailSchema>;
