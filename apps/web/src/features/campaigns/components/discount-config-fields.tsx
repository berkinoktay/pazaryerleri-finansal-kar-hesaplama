'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';

import { DiscountType, DiscountValueKind } from '@pazarsync/db/enums';

import { DateInput } from '@/components/patterns/date-input';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api-error';
import {
  businessZoneIsoToLocalWallClock,
  localWallClockAsBusinessZoneIso,
} from '@/lib/business-timezone-date';

import {
  visibleConfigFields,
  type ConfigFieldKey,
  type DiscountConfigFormValues,
} from '../lib/discount-config';

// Display order for the discount-type picker (all six kurgu).
const DISCOUNT_TYPE_OPTIONS: readonly DiscountType[] = [
  DiscountType.NET,
  DiscountType.CONDITIONAL_BASKET,
  DiscountType.CONDITIONAL_QUANTITY,
  DiscountType.BUY_X_PAY_Y,
  DiscountType.NTH_PRODUCT,
  DiscountType.CODE,
];

// The per-type config fields other than valueKind are free-text numeric strings; this map only
// decides the mobile keyboard hint (decimal for money, numeric for counts).
const NUMERIC_FIELD_MODE: Record<Exclude<ConfigFieldKey, 'valueKind'>, 'decimal' | 'numeric'> = {
  value: 'decimal',
  minBasketAmount: 'decimal',
  minQuantity: 'numeric',
  buyQuantity: 'numeric',
  payQuantity: 'numeric',
  nthIndex: 'numeric',
};

// BUY_X_PAY_Y panel bounds (mirror Trendyol's panel): the buy quantity is a Select of 2..5 and
// the pay quantity is a DEPENDENT Select of 1..buy-1. Rendering them as Selects (instead of the
// generic numeric Input) makes an invalid pair (buy < 2, pay >= buy) impossible to pick.
const BUY_QUANTITY_MIN = 2;
const BUY_QUANTITY_MAX = 5;

const BUY_QUANTITY_OPTIONS: readonly number[] = Array.from(
  { length: BUY_QUANTITY_MAX - BUY_QUANTITY_MIN + 1 },
  (_, i) => BUY_QUANTITY_MIN + i,
);

/** Valid pay quantities for a chosen buy quantity: 1 .. buy-1 (empty until buy is picked). */
function payQuantityOptions(buyQuantity: string | undefined): readonly number[] {
  const buy = buyQuantity !== undefined ? Number(buyQuantity) : Number.NaN;
  if (!Number.isInteger(buy) || buy <= 1) return [];
  return Array.from({ length: buy - 1 }, (_, i) => i + 1);
}

// The value-kind options. FIXED_PRICE ("X. ürün Y TL") is only valid for the NTH_PRODUCT kurgu,
// filtered out for every other type below.
const VALUE_KIND_OPTIONS: readonly DiscountValueKind[] = [
  DiscountValueKind.AMOUNT,
  DiscountValueKind.PERCENT,
  DiscountValueKind.FIXED_PRICE,
];

const VALUE_KIND_LABEL_KEY = {
  AMOUNT: 'valueKindAmount',
  PERCENT: 'valueKindPercent',
  FIXED_PRICE: 'valueKindFixed',
} as const satisfies Record<DiscountValueKind, string>;

// Config fields cleared when the discount type changes, so a value valid for the old kurgu
// (e.g. FIXED_PRICE picked under NTH_PRODUCT) never lingers into a type that forbids it.
const CLEARABLE_CONFIG_FIELDS: readonly ConfigFieldKey[] = [
  'valueKind',
  'value',
  'minBasketAmount',
  'minQuantity',
  'buyQuantity',
  'payQuantity',
  'nthIndex',
];

// The RHF-backed form fields — a backend VALIDATION_ERROR whose `field` is one of these maps to
// a `form.setError`; `file` (owned by the upload dialog's errorCode path) and `name` (local
// state, rendered inline) are handled outside this set so no issue renders twice.
const RHF_FIELD_NAMES = [
  'discountType',
  'valueKind',
  'value',
  'minBasketAmount',
  'minQuantity',
  'buyQuantity',
  'payQuantity',
  'nthIndex',
  'startsAt',
  'endsAt',
] as const satisfies readonly (keyof DiscountConfigFormValues)[];

export function isRhfFieldName(field: string): field is (typeof RHF_FIELD_NAMES)[number] {
  return RHF_FIELD_NAMES.some((name) => name === field);
}

/**
 * Maps a config-field validation code (from the client `discountConfigFormSchema`, which mirrors
 * the backend gate 1:1) to its inline message. Codes group onto a compact set of buckets — the
 * SCREAMING_SNAKE_CASE code stays the RHF error message so a backend 422 lights up the SAME copy.
 * Exported so the upload dialog's file/name inline errors reuse the same bucket mapping.
 */
export function useConfigFieldErrorMessage(): (code: string) => string {
  const t = useTranslations('discountsPage.upload.fieldErrors');
  return (code) => {
    switch (code) {
      case 'VALUE_REQUIRED':
      case 'VALUE_KIND_REQUIRED':
      case 'MIN_BASKET_REQUIRED':
      case 'MIN_QUANTITY_REQUIRED':
      case 'BUY_QUANTITY_REQUIRED':
      case 'PAY_QUANTITY_REQUIRED':
      case 'NTH_INDEX_REQUIRED':
      case 'START_REQUIRED':
      case 'END_REQUIRED':
        return t('required');
      case 'INVALID_MIN_QUANTITY':
      case 'INVALID_BUY_QUANTITY':
      case 'INVALID_PAY_QUANTITY':
      case 'INVALID_NTH_INDEX':
        return t('integer');
      case 'INVALID_DISCOUNT_VALUE':
      case 'INVALID_MIN_BASKET':
        return t('decimal');
      case 'PAY_MUST_BE_LESS_THAN_BUY':
        return t('payLessThanBuy');
      case 'VALUE_NOT_ALLOWED':
        return t('valueNotAllowed');
      case 'NTH_INDEX_OUT_OF_RANGE':
        return t('nthRange');
      case 'FIXED_PRICE_ONLY_FOR_NTH':
        return t('fixedOnlyNth');
      case 'PERCENT_OVER_100':
        return t('percentOver100');
      case 'END_BEFORE_START':
        return t('endBeforeStart');
      // Magnitude-bound + BUY_X_PAY_Y out-of-range codes (backend + client mirror) share the
      // generic "value out of range" copy — the dependent Selects make these unreachable in the
      // UI, so they only surface on a raw API 422; a precise per-bound key would be dead weight.
      case 'VALUE_TOO_LARGE':
      case 'MIN_BASKET_TOO_LARGE':
      case 'INT_TOO_LARGE':
      case 'BUY_QUANTITY_OUT_OF_RANGE':
      case 'PAY_QUANTITY_TOO_SMALL':
        return t('generic');
      default:
        return t('generic');
    }
  };
}

export interface DiscountConfigFieldsProps {
  /** The RHF form driving the config (discount type + per-type parameters + window). */
  form: UseFormReturn<DiscountConfigFormValues>;
  /** The optional list name — local state (the config schema is a ZodEffects that can't carry it). */
  nameValue: string;
  onNameChange: (value: string) => void;
  /**
   * The submit mutation's error. On a `VALIDATION_ERROR` its `problem.errors[]` are walked into
   * inline field messages (config fields via `form.setError`, `name` via an inline line) — since
   * `VALIDATION_ERROR` is globally silenced, this is the ONLY feedback for a config/name 422.
   */
  submitError?: Error | null;
}

/**
 * The shared config section of the İndirimler (Discounts) upload + edit forms: an optional list
 * name, the discount type picker, ONLY the parameters that type uses (rendered from
 * `CONFIG_FIELDS_BY_TYPE`), and the required campaign-window (start + end) date group. Both the
 * upload dialog (which adds the file dropzone above) and the config-edit dialog render it, so the
 * field map + the backend server-error plumbing live in ONE place. MUST be rendered inside a
 * `<Form {...form}>` provider (the caller owns the `<form>` element and submit).
 */
export function DiscountConfigFields({
  form,
  nameValue,
  onNameChange,
  submitError,
}: DiscountConfigFieldsProps): React.ReactElement {
  const t = useTranslations('discountsPage.upload');
  const tFields = useTranslations('discountsPage.upload.fields');
  const tTypes = useTranslations('discountsPage.types');
  const configFieldError = useConfigFieldErrorMessage();
  const nameFieldId = React.useId();

  // useWatch (a subscription hook) instead of form.watch() so the component re-renders the
  // per-type field set when the kurgu changes without tripping React Compiler's memo-unsafe rule.
  // The `defaultValue` is only a fallback — the form's defaultValues already register the type
  // (NET for a fresh upload, the saved kurgu for an edit), so useWatch returns the real value.
  const currentType = useWatch({
    control: form.control,
    name: 'discountType',
    defaultValue: DiscountType.NET,
  });
  // The pay Select's option list + its snap-back reset both depend on the chosen buy quantity;
  // watch it (like `currentType`) so the dependent Select re-renders when buy changes.
  const currentBuyQuantity = useWatch({ control: form.control, name: 'buyQuantity' });
  const fields = visibleConfigFields(currentType);
  const valueKindOptions =
    currentType === DiscountType.NTH_PRODUCT
      ? VALUE_KIND_OPTIONS
      : VALUE_KIND_OPTIONS.filter((kind) => kind !== DiscountValueKind.FIXED_PRICE);

  // `name` is local state, so its backend error is DERIVED from the mutation error rather than
  // mirrored into state (no setState-in-effect). It clears when the next submit's error no longer
  // carries a name issue.
  const nameServerError = React.useMemo<string | null>(() => {
    if (!(submitError instanceof ApiError) || submitError.code !== 'VALIDATION_ERROR') return null;
    return submitError.problem.errors?.find((issue) => issue.field === 'name')?.code ?? null;
  }, [submitError]);

  const resetConfigFields = React.useCallback(() => {
    for (const key of CLEARABLE_CONFIG_FIELDS) form.setValue(key, undefined);
    form.clearErrors(CLEARABLE_CONFIG_FIELDS);
  }, [form]);

  // Surface backend VALIDATION_ERROR field issues inline (the global toast pipeline silences
  // VALIDATION_ERROR). Config fields are pushed into RHF via form.setError → FormMessage; `name`
  // is derived above; `file` is skipped because the upload dialog's errorCode path owns it, so no
  // issue renders twice. The client zod schema mirrors the backend gate 1:1, so in practice this
  // only fires for backend-only checks or a genuine client/backend drift. (Canonical pattern from
  // apps/web/CLAUDE.md — an effect is required because setError writes into external RHF state.)
  React.useEffect(() => {
    if (!(submitError instanceof ApiError) || submitError.code !== 'VALIDATION_ERROR') return;
    for (const issue of submitError.problem.errors ?? []) {
      if (issue.field === 'file' || issue.field === 'name') continue;
      if (isRhfFieldName(issue.field)) {
        form.setError(issue.field, { type: 'server', message: issue.code });
      }
    }
  }, [submitError, form]);

  const renderConfigField = (key: ConfigFieldKey): React.ReactElement => {
    if (key === 'valueKind') {
      return (
        <FormField
          key={key}
          control={form.control}
          name="valueKind"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{tFields('valueKind')}</FormLabel>
              <Select value={field.value} onValueChange={(value) => field.onChange(value)}>
                <FormControl>
                  <SelectTrigger invalid={fieldState.error !== undefined}>
                    <SelectValue placeholder={tFields('valueKind')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {valueKindOptions.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {tFields(VALUE_KIND_LABEL_KEY[kind])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage render={configFieldError} />
            </FormItem>
          )}
        />
      );
    }

    if (key === 'buyQuantity') {
      return (
        <FormField
          key={key}
          control={form.control}
          name="buyQuantity"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{tFields('buyQuantity')}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  // Dependent pay: if the current pay is now out of range (> buy-1), snap it to
                  // the biggest still-valid discount (buy-1). Event-driven, NOT an effect — the
                  // repo forbids react-hooks/set-state-in-effect.
                  const maxPay = Number(value) - 1;
                  const currentPay = form.getValues('payQuantity');
                  if (currentPay !== undefined && Number(currentPay) > maxPay) {
                    form.setValue('payQuantity', String(maxPay));
                    form.clearErrors('payQuantity');
                  }
                }}
              >
                <FormControl>
                  <SelectTrigger invalid={fieldState.error !== undefined}>
                    <SelectValue placeholder={tFields('buyQuantity')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {BUY_QUANTITY_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {String(n)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage render={configFieldError} />
            </FormItem>
          )}
        />
      );
    }

    if (key === 'payQuantity') {
      const payOptions = payQuantityOptions(currentBuyQuantity);
      return (
        <FormField
          key={key}
          control={form.control}
          name="payQuantity"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{tFields('payQuantity')}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => field.onChange(value)}
                disabled={payOptions.length === 0}
              >
                <FormControl>
                  <SelectTrigger invalid={fieldState.error !== undefined}>
                    <SelectValue placeholder={tFields('payQuantity')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {payOptions.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {String(n)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage render={configFieldError} />
            </FormItem>
          )}
        />
      );
    }

    return (
      <FormField
        key={key}
        control={form.control}
        name={key}
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{tFields(key)}</FormLabel>
            <FormControl>
              <Input
                inputMode={NUMERIC_FIELD_MODE[key]}
                value={field.value ?? ''}
                onChange={(event) =>
                  field.onChange(event.target.value === '' ? undefined : event.target.value)
                }
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
                invalid={fieldState.error !== undefined}
              />
            </FormControl>
            <FormMessage render={configFieldError} />
          </FormItem>
        )}
      />
    );
  };

  return (
    <div className="gap-md flex flex-col">
      <div className="gap-3xs flex flex-col">
        <Label htmlFor={nameFieldId}>{t('name')}</Label>
        <Input
          id={nameFieldId}
          value={nameValue}
          invalid={nameServerError !== null}
          onChange={(event) => onNameChange(event.target.value)}
        />
        {nameServerError !== null ? (
          <p className="text-2xs text-destructive font-medium" role="alert">
            {configFieldError(nameServerError)}
          </p>
        ) : null}
      </div>

      <FormField
        control={form.control}
        name="discountType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('typeLabel')}</FormLabel>
            <Select
              value={field.value}
              onValueChange={(value) => {
                field.onChange(value);
                // New kurgu ⇒ wipe the previous type's parameters + their errors.
                resetConfigFields();
              }}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {DISCOUNT_TYPE_OPTIONS.map((type) => (
                  <SelectItem key={type} value={type}>
                    {tTypes(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>
        )}
      />

      <div className="gap-md grid sm:grid-cols-2">
        {fields.map((key) => renderConfigField(key))}
      </div>

      <div className="gap-3xs flex flex-col">
        <Label>{tFields('dateRange')}</Label>
        <div className="gap-sm grid grid-cols-1 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="startsAt"
            render={({ field, fieldState }) => (
              <div className="gap-3xs flex flex-col">
                <DateInput
                  className="w-full"
                  withTime
                  placeholder={tFields('startPlaceholder')}
                  // Default to the tariff-week rollover (08:00) so a "21 Temmuz" start lands
                  // AFTER the week's 08:00 boundary and resolves to the 21–28 week — not the
                  // previous one, which a 00:00 start would fall into.
                  defaultTime={{ hours: 8, minutes: 0 }}
                  // Bridge to the business timezone: the picker speaks browser-local wall clock,
                  // but a campaign bound must mean Istanbul wall clock (single source of tz).
                  value={field.value ? businessZoneIsoToLocalWallClock(field.value) : null}
                  onChange={(date) =>
                    field.onChange(
                      date !== null ? localWallClockAsBusinessZoneIso(date) : undefined,
                    )
                  }
                />
                {fieldState.error !== undefined ? (
                  <p className="text-2xs text-destructive font-medium">
                    {configFieldError(String(fieldState.error.message ?? ''))}
                  </p>
                ) : null}
              </div>
            )}
          />
          <FormField
            control={form.control}
            name="endsAt"
            render={({ field, fieldState }) => (
              <div className="gap-3xs flex flex-col">
                <DateInput
                  className="w-full"
                  withTime
                  placeholder={tFields('endPlaceholder')}
                  // Default to 07:59 — the last minute before the next tariff-week rollover —
                  // so a chosen end day stays inside that week rather than spilling into the
                  // next one.
                  defaultTime={{ hours: 7, minutes: 59 }}
                  // Bridge to the business timezone: the picker speaks browser-local wall clock,
                  // but a campaign bound must mean Istanbul wall clock (single source of tz).
                  value={field.value ? businessZoneIsoToLocalWallClock(field.value) : null}
                  onChange={(date) =>
                    field.onChange(
                      date !== null ? localWallClockAsBusinessZoneIso(date) : undefined,
                    )
                  }
                />
                {fieldState.error !== undefined ? (
                  <p className="text-2xs text-destructive font-medium">
                    {configFieldError(String(fieldState.error.message ?? ''))}
                  </p>
                ) : null}
              </div>
            )}
          />
        </div>
      </div>
    </div>
  );
}
