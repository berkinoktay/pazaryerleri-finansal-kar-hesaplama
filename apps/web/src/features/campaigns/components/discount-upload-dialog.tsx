'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { DiscountType, DiscountValueKind } from '@pazarsync/db/enums';

import { DateInput } from '@/components/patterns/date-input';
import { FileUpload } from '@/components/patterns/file-upload';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
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
  discountConfigFormSchema,
  visibleConfigFields,
  type ConfigFieldKey,
  type DiscountConfigFormValues,
} from '../lib/discount-config';

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

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

// The RHF-backed form fields — a backend VALIDATION_ERROR whose `field` is one of these maps
// to a `form.setError`; `file` (owned by the errorCode path) and `name` (local state, rendered
// inline) are handled outside this set so no issue renders twice.
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

function isRhfFieldName(field: string): field is (typeof RHF_FIELD_NAMES)[number] {
  return RHF_FIELD_NAMES.some((name) => name === field);
}

/**
 * Maps a backend file-rejection code to its localized message key bucket. Discount-specific
 * codes are `EMPTY_DISCOUNT_FILE` / `INVALID_DISCOUNT_FORMAT`; the rest are the shared upload
 * codes every vertical raises.
 */
function useFileErrorMessage(): (code: string | null | undefined) => string | null {
  const t = useTranslations('discountsPage.upload.errors');
  return (code) => {
    switch (code) {
      case null:
      case undefined:
        return null;
      case 'NOT_XLSX':
      case 'CORRUPT_FILE':
        return t('notReadable');
      case 'EMPTY_DISCOUNT_FILE':
        return t('empty');
      case 'ROW_CAP_EXCEEDED':
      case 'COL_CAP_EXCEEDED':
      case 'PAYLOAD_TOO_LARGE':
        return t('tooLarge');
      case 'SHEET_NOT_FOUND':
      case 'INVALID_DISCOUNT_FORMAT':
      case 'MISSING_REQUIRED_HEADERS':
      case 'AMBIGUOUS_HEADERS':
        return t('wrongFormat');
      default:
        return t('generic');
    }
  };
}

/**
 * Maps a config-field validation code (from the client `discountConfigFormSchema`, which mirrors
 * the backend gate 1:1) to its inline message. Codes group onto a compact set of buckets — the
 * SCREAMING_SNAKE_CASE code stays the RHF error message so a backend 422 lights up the SAME copy.
 */
function useConfigFieldErrorMessage(): (code: string) => string {
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

export interface DiscountUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires on submit with the validated config, the chosen file, and the optional list name. */
  onSubmit: (config: DiscountConfigFormValues, file: File, name?: string) => void;
  /** True while the import request is in flight (drives the submit button). */
  submitting?: boolean;
  /** Backend file-rejection code (from `extractFileErrorCode`), shown inline. */
  errorCode?: string | null;
  /**
   * The import mutation's error. On a `VALIDATION_ERROR` its `problem.errors[]` are walked into
   * inline field messages (config via `form.setError`, `name` via an inline line) — since
   * `VALIDATION_ERROR` is globally silenced, this is the ONLY feedback for a config/name 422.
   */
  submitError?: Error | null;
  /** Clears the last import error when the seller picks a different file. */
  onResetError?: () => void;
}

/**
 * Excel-upload dialog over the İndirimler list. Unlike the other campaign upload dialogs (which
 * only take a file), the discount kurgu (type + its per-type parameters) is NOT in the sheet —
 * Trendyol reuses the SAME product-selection file for every discount type — so the seller sets
 * it here: the dropzone, an optional list name, the discount type, and ONLY the parameters that
 * type uses (rendered from `CONFIG_FIELDS_BY_TYPE`). Optional order-limit + date-range settings
 * ride in a sub-block. Submitting creates the list and the caller routes on to the detail screen.
 */
export function DiscountUploadDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting = false,
  errorCode,
  submitError,
  onResetError,
}: DiscountUploadDialogProps): React.ReactElement {
  const t = useTranslations('discountsPage.upload');
  const tFields = useTranslations('discountsPage.upload.fields');
  const tTypes = useTranslations('discountsPage.types');
  const tCommon = useTranslations('common');
  const fileErrorMessage = useFileErrorMessage();
  const configFieldError = useConfigFieldErrorMessage();

  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState('');

  // `name` is local state (not RHF — the config schema is a ZodEffects that can't carry it), so
  // its backend error is DERIVED from the mutation error rather than mirrored into state (no
  // setState-in-effect). It clears when the next submit's error no longer carries a name issue.
  const nameServerError = React.useMemo<string | null>(() => {
    if (!(submitError instanceof ApiError) || submitError.code !== 'VALIDATION_ERROR') return null;
    return submitError.problem.errors?.find((issue) => issue.field === 'name')?.code ?? null;
  }, [submitError]);

  const form = useForm<DiscountConfigFormValues>({
    resolver: zodResolver(discountConfigFormSchema),
    defaultValues: { discountType: DiscountType.NET },
  });

  // useWatch (a subscription hook) instead of form.watch() so the component re-renders the
  // per-type field set when the kurgu changes without tripping React Compiler's
  // incompatible-library rule on the memo-unsafe watch() function.
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

  const resetConfigFields = React.useCallback(() => {
    for (const key of CLEARABLE_CONFIG_FIELDS) form.setValue(key, undefined);
    form.clearErrors(CLEARABLE_CONFIG_FIELDS);
  }, [form]);

  // Surface backend VALIDATION_ERROR field issues inline (the global toast pipeline silences
  // VALIDATION_ERROR). Config fields are pushed into RHF via form.setError → FormMessage; `name`
  // is derived above; `file` is skipped because the errorCode path already owns it, so no issue
  // renders twice. The client zod schema mirrors the backend gate 1:1, so in practice this only
  // fires for backend-only checks or a genuine client/backend drift. (Canonical pattern from
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

  const handleOpenChange = (next: boolean): void => {
    // Reset the whole form (config + file + name) when the dialog closes so reopening starts clean.
    if (!next) {
      form.reset({ discountType: DiscountType.NET });
      setFile(null);
      setName('');
      onResetError?.();
    }
    onOpenChange(next);
  };

  const handleValid = (values: DiscountConfigFormValues): void => {
    if (file === null) return;
    const trimmedName = name.trim();
    onSubmit(values, file, trimmedName === '' ? undefined : trimmedName);
  };

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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="discount-upload-modal flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit(handleValid)}
            className="gap-md flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="gap-md flex flex-col">
                <FileUpload
                  value={file}
                  accept=".xlsx"
                  maxSize={MAX_SIZE_BYTES}
                  prompt={t('prompt')}
                  hint={t('hint')}
                  ctaLabel={t('cta')}
                  error={fileErrorMessage(errorCode)}
                  onChange={(next) => {
                    setFile(next);
                    onResetError?.();
                  }}
                />

                <div className="gap-3xs flex flex-col">
                  <Label htmlFor="discount-list-name">{t('name')}</Label>
                  <Input
                    id="discount-list-name"
                    value={name}
                    invalid={nameServerError !== null}
                    onChange={(event) => setName(event.target.value)}
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
                                field.onChange(
                                  event.target.value === '' ? undefined : event.target.value,
                                )
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
                                field.value !== undefined && field.value !== ''
                                  ? new Date(field.value)
                                  : null
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
            </div>

            <DialogFooter className="shrink-0">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  {tCommon('cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={file === null} loading={submitting}>
                {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
