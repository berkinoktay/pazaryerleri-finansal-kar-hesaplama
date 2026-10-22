'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

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
import {
  businessZoneIsoToLocalWallClock,
  localWallClockAsBusinessZoneIso,
} from '@/lib/business-timezone-date';

import {
  NTH_INDEX_OPTIONS,
  visibleConfigFields,
  type ConfigFieldKey,
  type DiscountConfigFormValues,
} from '../lib/discount-config';

/*
 * Shared sections of the kurgu config forms. İndirimler and Kampanyalar configure the same kurgu
 * — the same per-type parameters and the same required campaign window — and differ only in the
 * offered kurgu set and the fields around them (Kampanyalar adds Trendyol's funding rate), so each
 * vertical's config-fields component composes these sections. They read the form from RHF context
 * typed on the shared `DiscountConfigFormValues` shape, which lets a vertical's form carry extra
 * fields the sections never touch. MUST be rendered inside a `<Form {...form}>` provider.
 */

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

/**
 * Maps a config-field validation code (from the client config schema, which mirrors the backend
 * gate 1:1) to its inline message. Codes group onto a compact set of buckets — the
 * SCREAMING_SNAKE_CASE code stays the RHF error message so a backend 422 lights up the SAME copy.
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

export interface ConfigNameFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The backend `VALIDATION_ERROR` code for `name` (local state, outside RHF), shown inline. */
  serverError: string | null;
}

/** The optional upload name — local state, because the refined config schema can't carry it. */
export function ConfigNameField({
  label,
  value,
  onChange,
  serverError,
}: ConfigNameFieldProps): React.ReactElement {
  const configFieldError = useConfigFieldErrorMessage();
  const id = React.useId();

  return (
    <div className="gap-3xs flex flex-col">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        invalid={serverError !== null}
        onChange={(event) => onChange(event.target.value)}
      />
      {serverError !== null ? (
        <p className="text-2xs text-destructive font-medium" role="alert">
          {configFieldError(serverError)}
        </p>
      ) : null}
    </div>
  );
}

export interface ConfigTypeFieldProps {
  label: string;
  /** The kurgu this vertical offers, in display order. */
  typeOptions: readonly DiscountType[];
  /**
   * Wipes the previous kurgu's parameters right after the type changes. The owning form decides
   * what survives (it knows its own extra fields) — see {@link ConfigParameterGrid}.
   */
  onTypeChange: () => void;
}

/** The kurgu picker. */
export function ConfigTypeField({
  label,
  typeOptions,
  onTypeChange,
}: ConfigTypeFieldProps): React.ReactElement {
  const form = useFormContext<DiscountConfigFormValues>();
  const tTypes = useTranslations('discountsPage.types');

  return (
    <FormField
      control={form.control}
      name="discountType"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            value={field.value}
            onValueChange={(value) => {
              field.onChange(value);
              onTypeChange();
            }}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {typeOptions.map((type) => (
                <SelectItem key={type} value={type}>
                  {tTypes(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormItem>
      )}
    />
  );
}

/**
 * ONLY the parameters the chosen kurgu uses (rendered from `CONFIG_FIELDS_BY_TYPE`), two-up.
 *
 * Changing the kurgu must wipe the previous type's parameters, so a value valid for the old type
 * (e.g. FIXED_PRICE under NTH_PRODUCT) never lingers into one that forbids it. Clearing an
 * OPTIONAL field back to "empty" needs two moves in RHF, because a mounted controller can never
 * observe undefined — useWatch falls back to its mount-time default (an edit dialog seeds the
 * saved config), which kept the UI showing the old choice while the submitted state was empty:
 *   1. the owning form's `onTypeChange` runs `form.reset` with only the surviving fields — reset
 *      replaces BOTH _formValues and _defaultValues (setValue(field, undefined) only touches the
 *      former);
 *   2. the grid is keyed by the kurgu, so its controllers remount and no live useWatch keeps
 *      serving its captured pre-reset default.
 */
export function ConfigParameterGrid(): React.ReactElement {
  const form = useFormContext<DiscountConfigFormValues>();
  const tFields = useTranslations('discountsPage.upload.fields');
  const configFieldError = useConfigFieldErrorMessage();

  // useWatch (a subscription hook) instead of form.watch() so the grid re-renders the per-type
  // field set when the kurgu changes without tripping React Compiler's memo-unsafe rule. The
  // `defaultValue` is only a fallback — the form's defaultValues already register the type (NET
  // for a fresh upload, the saved kurgu for an edit), so useWatch returns the real value.
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
              {/* `?? ''` keeps the Select CONTROLLED when the type-change reset wipes the field
                  to undefined — an undefined value flips Radix to uncontrolled, which keeps
                  displaying the stale old choice while RHF state is already empty. */}
              <Select value={field.value ?? ''} onValueChange={(value) => field.onChange(value)}>
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
                value={field.value ?? ''}
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
                value={field.value ?? ''}
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

    if (key === 'nthIndex') {
      // The "X. ürün" target sits in the fixed panel range [2, 4]; a Select makes an out-of-range
      // target impossible to pick (no dependent field, unlike buyQuantity). The form value stays a
      // string ('2' | '3' | '4') so the shared string config contract is unchanged.
      return (
        <FormField
          key={key}
          control={form.control}
          name="nthIndex"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{tFields('nthIndex')}</FormLabel>
              <Select value={field.value ?? ''} onValueChange={(value) => field.onChange(value)}>
                <FormControl>
                  <SelectTrigger invalid={fieldState.error !== undefined}>
                    <SelectValue placeholder={tFields('nthIndex')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {NTH_INDEX_OPTIONS.map((n) => (
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
    // Keyed by type: the remount is half of the type-change wipe (see the doc comment above).
    <div key={currentType} className="gap-md grid sm:grid-cols-2">
      {fields.map((key) => renderConfigField(key))}
    </div>
  );
}

/** The required campaign window (start + end), in the business timezone. */
export function ConfigWindowFields(): React.ReactElement {
  const form = useFormContext<DiscountConfigFormValues>();
  const tFields = useTranslations('discountsPage.upload.fields');
  const configFieldError = useConfigFieldErrorMessage();

  return (
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
                  field.onChange(date !== null ? localWallClockAsBusinessZoneIso(date) : undefined)
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
                  field.onChange(date !== null ? localWallClockAsBusinessZoneIso(date) : undefined)
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
  );
}
