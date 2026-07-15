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
  'orderLimit',
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
        return t('required');
      case 'INVALID_MIN_QUANTITY':
      case 'INVALID_BUY_QUANTITY':
      case 'INVALID_PAY_QUANTITY':
      case 'INVALID_NTH_INDEX':
      case 'INVALID_ORDER_LIMIT':
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
 * `CONFIG_FIELDS_BY_TYPE`), and an optional order-limit + campaign-window sub-block. Both the
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

      <div className="border-border bg-surface-subtle gap-md p-md flex flex-col rounded-lg border">
        <p className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          {t('optionalSection')}
        </p>

        <div className="gap-md grid sm:grid-cols-2">
          <FormField
            control={form.control}
            name="orderLimit"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>{tFields('orderLimit')}</FormLabel>
                <FormControl>
                  <Input
                    inputMode="numeric"
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

          <div className="gap-3xs flex flex-col">
            <Label>{tFields('dateRange')}</Label>
            <div className="gap-sm grid grid-cols-1 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="startsAt"
                render={({ field }) => (
                  <DateInput
                    className="w-full"
                    value={
                      field.value !== undefined && field.value !== '' ? new Date(field.value) : null
                    }
                    onChange={(date) =>
                      field.onChange(date !== null ? date.toISOString() : undefined)
                    }
                  />
                )}
              />
              <FormField
                control={form.control}
                name="endsAt"
                render={({ field, fieldState }) => (
                  <div className="gap-3xs flex flex-col">
                    <DateInput
                      className="w-full"
                      value={
                        field.value !== undefined && field.value !== ''
                          ? new Date(field.value)
                          : null
                      }
                      onChange={(date) =>
                        field.onChange(date !== null ? date.toISOString() : undefined)
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
      </div>
    </div>
  );
}
