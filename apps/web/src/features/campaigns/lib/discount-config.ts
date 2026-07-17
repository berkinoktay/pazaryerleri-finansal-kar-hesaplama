'use client';

import { useMemo } from 'react';

import { useTranslations } from 'next-intl';
import { z } from 'zod';

import { DiscountType, DiscountValueKind } from '@pazarsync/db/enums';
import { formatCurrency } from '@pazarsync/utils';

/**
 * Client-side config model for the İndirimler (Discounts) upload + edit forms. Trendyol reuses
 * the SAME product-selection sheet for every discount type; the discount kurgu (type + its
 * per-type parameters) rides on the form and is persisted onto the PazarSync list row. This lib
 * owns three things the UI shares:
 *   1. {@link CONFIG_FIELDS_BY_TYPE} — which parameter fields each discount type shows.
 *   2. {@link discountConfigFormSchema} — the client mirror of the backend `DiscountConfigFieldsSchema`
 *      + `refineDiscountConfig` (same SCREAMING_SNAKE_CASE codes + field paths, so `form.setError`
 *      from a backend 422 lines up with the client-side zod issues).
 *   3. {@link useDescribeDiscountConfig} — a one-line human summary of a saved config.
 */

// ─── Field visibility ────────────────────────────────────────────────────────

export type ConfigFieldKey =
  | 'valueKind'
  | 'value'
  | 'minBasketAmount'
  | 'minQuantity'
  | 'buyQuantity'
  | 'payQuantity'
  | 'nthIndex';

/** Which parameter fields are visible per discount kurgu (upload + edit form). */
export const CONFIG_FIELDS_BY_TYPE: Record<DiscountType, readonly ConfigFieldKey[]> = {
  NET: ['valueKind', 'value'],
  CONDITIONAL_BASKET: ['valueKind', 'value', 'minBasketAmount'],
  CONDITIONAL_QUANTITY: ['valueKind', 'value', 'minQuantity'],
  BUY_X_PAY_Y: ['buyQuantity', 'payQuantity'],
  NTH_PRODUCT: ['valueKind', 'value', 'nthIndex'],
  CODE: ['valueKind', 'value', 'minBasketAmount'],
} as const;

/** Thin accessor for the field-visibility map (keeps callers from importing the constant). */
export function visibleConfigFields(type: DiscountType): readonly ConfigFieldKey[] {
  return CONFIG_FIELDS_BY_TYPE[type];
}

// ─── Client-side validation (mirror of the backend gate) ─────────────────────

// Same patterns the backend uses: money is up to 2 decimals; counts are positive integers.
const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;
const INT_RE = /^\d+$/;

// Trendyol caps the "X. ürün" target at the 2nd–4th item; percentage discounts can't exceed 100%.
const NTH_INDEX_MIN = 2;
const NTH_INDEX_MAX = 4;
const PERCENT_MAX = 100;

// Magnitude ceilings mirroring the backend gate: `value`/`minBasketAmount` are Decimal(12,2)
// (10 integer digits + 2 decimals); the count fields are 32-bit Int, kept below 2^31-1.
const MAX_DECIMAL_VALUE = 9999999999.99;
const MAX_INT_VALUE = 2000000000;
const INT_CONFIG_FIELDS = ['minQuantity', 'buyQuantity', 'payQuantity', 'nthIndex'] as const;

// Multipart upload + JSON edit both carry every config field as a STRING, so a single object
// mirrors both entry paths — exactly like the backend's `DiscountConfigFieldsSchema`.
const discountConfigFieldsSchema = z.object({
  discountType: z.enum(DiscountType),
  valueKind: z.enum(DiscountValueKind).optional(),
  value: z.string().regex(DECIMAL_RE, 'INVALID_DISCOUNT_VALUE').optional(),
  minBasketAmount: z.string().regex(DECIMAL_RE, 'INVALID_MIN_BASKET').optional(),
  minQuantity: z.string().regex(INT_RE, 'INVALID_MIN_QUANTITY').optional(),
  buyQuantity: z.string().regex(INT_RE, 'INVALID_BUY_QUANTITY').optional(),
  payQuantity: z.string().regex(INT_RE, 'INVALID_PAY_QUANTITY').optional(),
  nthIndex: z.string().regex(INT_RE, 'INVALID_NTH_INDEX').optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

/**
 * Per-type requirement rules. Client mirror of the backend `refineDiscountConfig` — same codes,
 * same field paths, so a backend 422's `form.setError(field, code)` and the client-side zod
 * issue light up the SAME inline message.
 */
export const discountConfigFormSchema = discountConfigFieldsSchema.superRefine((val, ctx) => {
  const need = (field: ConfigFieldKey | 'startsAt' | 'endsAt', code: string): void => {
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
    if (val.nthIndex === undefined) {
      need('nthIndex', 'NTH_INDEX_REQUIRED');
    } else {
      const n = Number(val.nthIndex);
      if (n < NTH_INDEX_MIN || n > NTH_INDEX_MAX) need('nthIndex', 'NTH_INDEX_OUT_OF_RANGE');
    }
  } else if (val.valueKind === 'FIXED_PRICE') {
    need('valueKind', 'FIXED_PRICE_ONLY_FOR_NTH');
  }

  if (val.valueKind === 'PERCENT' && val.value !== undefined && Number(val.value) > PERCENT_MAX) {
    need('value', 'PERCENT_OVER_100');
  }

  // Both campaign dates are required (mirror of the backend gate).
  if (val.startsAt === undefined) need('startsAt', 'START_REQUIRED');
  if (val.endsAt === undefined) need('endsAt', 'END_REQUIRED');

  if (
    val.startsAt !== undefined &&
    val.endsAt !== undefined &&
    new Date(val.startsAt).getTime() >= new Date(val.endsAt).getTime()
  ) {
    need('endsAt', 'END_BEFORE_START');
  }

  // Magnitude bounds — a clean inline error instead of a backend 422/500 on the write.
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
});

/**
 * The discount configuration the upload/edit form produces (re-homed from
 * `../api/import-discount-list.api`). Inferred from {@link discountConfigFormSchema} so the RHF
 * resolver and the value type never drift.
 */
export type DiscountConfigFormValues = z.infer<typeof discountConfigFormSchema>;

// ─── Human summary of a saved config ─────────────────────────────────────────

/**
 * The minimal config shape the summary needs. Deliberately structural so BOTH the list DTO
 * (`DiscountListListItem` / `DiscountListRow`, whose numeric fields are `number | null`) AND the
 * form values (`DiscountConfigFormValues`, whose fields are optional strings) satisfy it without
 * any mapping. The summary reads only the fields the row's discount type actually uses.
 */
export interface DiscountConfigLike {
  discountType: DiscountType;
  valueKind?: DiscountValueKind | null;
  value?: string | null;
  minBasketAmount?: string | null;
  minQuantity?: number | string | null;
  buyQuantity?: number | string | null;
  payQuantity?: number | string | null;
  nthIndex?: number | string | null;
}

/**
 * Returns a mapper from a saved discount config to a one-line human summary (e.g. "20% off over
 * ₺1.000,00 basket"), scoped to the İndirimler namespace. Dispatch is a `Record<DiscountType>`
 * (no switch chain); the value-kind branch inside each entry picks the AMOUNT / PERCENT /
 * FIXED_PRICE template. `useMemo`-stable on the next-intl `t` so it can sit in a table `columns`
 * dependency list without churning it.
 */
export function useDescribeDiscountConfig(): (config: DiscountConfigLike) => string {
  const t = useTranslations('discountsPage.configSummary');

  return useMemo(() => {
    const money = (v: string | null | undefined): string => formatCurrency(v ?? '0');
    const int = (v: number | string | null | undefined): string => String(v ?? '');
    const pct = (v: string | null | undefined): string => v ?? '';

    const byType: Record<DiscountType, (c: DiscountConfigLike) => string> = {
      NET: (c) =>
        c.valueKind === 'PERCENT'
          ? t('netPercent', { percent: pct(c.value) })
          : t('netAmount', { amount: money(c.value) }),
      CONDITIONAL_BASKET: (c) =>
        c.valueKind === 'PERCENT'
          ? t('basketPercent', { percent: pct(c.value), min: money(c.minBasketAmount) })
          : t('basketAmount', { amount: money(c.value), min: money(c.minBasketAmount) }),
      CONDITIONAL_QUANTITY: (c) =>
        c.valueKind === 'PERCENT'
          ? t('quantityPercent', { percent: pct(c.value), qty: int(c.minQuantity) })
          : t('quantityAmount', { amount: money(c.value), qty: int(c.minQuantity) }),
      BUY_X_PAY_Y: (c) => t('buyXPayY', { buy: int(c.buyQuantity), pay: int(c.payQuantity) }),
      NTH_PRODUCT: (c) => {
        if (c.valueKind === 'FIXED_PRICE') {
          return t('nthFixed', { nth: int(c.nthIndex), price: money(c.value) });
        }
        if (c.valueKind === 'PERCENT') {
          return t('nthPercent', { percent: pct(c.value), nth: int(c.nthIndex) });
        }
        return t('nthAmount', { amount: money(c.value), nth: int(c.nthIndex) });
      },
      CODE: (c) =>
        c.valueKind === 'PERCENT'
          ? t('codePrefix') +
            t('basketPercent', { percent: pct(c.value), min: money(c.minBasketAmount) })
          : t('codePrefix') +
            t('basketAmount', { amount: money(c.value), min: money(c.minBasketAmount) }),
    };

    return (config: DiscountConfigLike): string => byType[config.discountType](config);
  }, [t]);
}
