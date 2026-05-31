'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { CostProfileType, Currency, FxRateMode } from '../types/cost-profile.types';
import type { CostProfile } from '../types/cost-profile.types';
import { useFxRatesLatest } from '../hooks/use-fx-rates-latest';
import {
  costProfileFormSchema,
  type CostProfileFormValues,
  VAT_RATE_OPTIONS,
} from '../validation/cost-profile.schema';
import { formatFxRateSource } from '../lib/format-fx-rate-source';

import { CostProfileFxPreview } from './cost-profile-fx-preview';
import { CostProfileTypeBadge } from './cost-profile-type-badge';

// Validation codes the schema sets as `message` — the same keys exist under
// `costs.form.validation.*` in next-intl. Anything not in this set is a
// genuine zod-internal message (e.g. "Invalid enum value") and should pass
// through untranslated.
const VALIDATION_CODES = new Set([
  'nameRequired',
  'nameTooLong',
  'amountRequired',
  'amountNegative',
  'manualFxRateRequired',
  'manualFxRatePositive',
  'tryMustUseAuto',
] as const);

type ValidationCode =
  | 'nameRequired'
  | 'nameTooLong'
  | 'amountRequired'
  | 'amountNegative'
  | 'manualFxRateRequired'
  | 'manualFxRatePositive'
  | 'tryMustUseAuto';

function knownValidationCode(value: string | undefined): ValidationCode | undefined {
  if (value === undefined) return undefined;
  return VALIDATION_CODES.has(value as ValidationCode) ? (value as ValidationCode) : undefined;
}

interface CostProfileFormProps {
  /** Active organization id — required to fetch live TCMB FX rates. */
  orgId: string | null;
  /** When editing an existing profile, supply it for pre-filling. */
  initialValues?: Partial<CostProfileFormValues>;
  onSubmit: (values: CostProfileFormValues) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

/**
 * Shared form for creating and editing cost profiles.
 *
 * Used by `CostProfileCreateDialog` (Costs page CTA) and PR 8's detail tab.
 * Fields: name, type, currency, amount, vatRate, fxRateMode, manualFxRate
 * (conditional on MANUAL + non-TRY), note. FX preview is reactive.
 */
export function CostProfileForm({
  orgId,
  initialValues,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: CostProfileFormProps): React.ReactElement {
  const t = useTranslations('costs.form');
  const tTypes = useTranslations('costs.types');
  const tFxMode = useTranslations('costs.fxMode');
  const tValidation = useTranslations('costs.form.validation');

  // Translate the schema's error code (costs.form.validation.<code>) for the
  // canonical FormMessage; unknown codes pass through (zod-internal messages).
  const renderValidation = (code: string): string => {
    const known = knownValidationCode(code);
    return known !== undefined ? tValidation(known) : code;
  };

  const { data: fxData } = useFxRatesLatest(orgId);

  const form = useForm<CostProfileFormValues>({
    resolver: zodResolver(costProfileFormSchema),
    defaultValues: {
      name: initialValues?.name ?? '',
      type: initialValues?.type ?? CostProfileType.COGS,
      currency: initialValues?.currency ?? Currency.TRY,
      amount: initialValues?.amount ?? '',
      vatRate: initialValues?.vatRate ?? 18,
      fxRateMode: initialValues?.fxRateMode ?? FxRateMode.AUTO,
      manualFxRate: initialValues?.manualFxRate ?? null,
      note: initialValues?.note ?? null,
    },
  });

  const watchedCurrency = form.watch('currency');
  const watchedFxRateMode = form.watch('fxRateMode');
  const watchedAmount = form.watch('amount');
  const watchedManualFxRate = form.watch('manualFxRate');

  // When currency changes to TRY, force AUTO mode (TRY profiles can't use MANUAL)
  React.useEffect(() => {
    if (watchedCurrency === Currency.TRY && watchedFxRateMode === FxRateMode.MANUAL) {
      form.setValue('fxRateMode', FxRateMode.AUTO, { shouldValidate: true });
    }
  }, [watchedCurrency, watchedFxRateMode, form]);

  const isTry = watchedCurrency === Currency.TRY;
  const isManual = watchedFxRateMode === FxRateMode.MANUAL;
  const showManualFxRate = !isTry && isManual;
  const showFxModeRadio = !isTry;

  // Resolve live AUTO rate for the selected currency
  const autoFxRate =
    watchedCurrency === Currency.USD
      ? (fxData?.USD?.rate ?? null)
      : watchedCurrency === Currency.EUR
        ? (fxData?.EUR?.rate ?? null)
        : null;
  const autoFxRateSource =
    watchedCurrency !== Currency.TRY && fxData
      ? watchedCurrency === Currency.USD
        ? fxData.USD !== null
          ? formatFxRateSource(`TCMB-${fxData.USD.date}`)
          : null
        : fxData.EUR !== null
          ? formatFxRateSource(`TCMB-${fxData.EUR.date}`)
          : null
      : null;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="gap-md flex flex-col">
        {/* Name */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.name')}</FormLabel>
              <FormControl>
                <Input placeholder={t('fields.namePlaceholder')} autoComplete="off" {...field} />
              </FormControl>
              <FormMessage render={renderValidation} />
            </FormItem>
          )}
        />

        {/* Type */}
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.type')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.values(CostProfileType).map((type) => (
                    <SelectItem key={type} value={type}>
                      <span className="gap-sm flex items-center">
                        <CostProfileTypeBadge type={type} iconOnly />
                        {tTypes(type)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage render={renderValidation} />
            </FormItem>
          )}
        />

        {/* Currency + Amount — side by side */}
        <div className="gap-sm grid grid-cols-[1fr_2fr]">
          <FormField
            control={form.control}
            name="currency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.currency')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {Object.values(Currency).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage render={renderValidation} />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.amount')}</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder={t('fields.amountPlaceholder')}
                    {...field}
                  />
                </FormControl>
                {/* FX preview lives directly under the amount field */}
                <CostProfileFxPreview
                  amount={watchedAmount}
                  currency={watchedCurrency}
                  fxRateMode={watchedFxRateMode}
                  manualFxRate={watchedManualFxRate}
                  autoFxRate={autoFxRate}
                  fxRateSource={autoFxRateSource}
                />
                <FormMessage render={renderValidation} />
              </FormItem>
            )}
          />
        </div>

        {/* VAT rate */}
        <FormField
          control={form.control}
          name="vatRate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.vatRate')}</FormLabel>
              <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {VAT_RATE_OPTIONS.map((rate) => (
                    <SelectItem key={rate} value={String(rate)}>
                      %{rate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage render={renderValidation} />
            </FormItem>
          )}
        />

        {/* FX rate mode — only for non-TRY */}
        {showFxModeRadio ? (
          <FormField
            control={form.control}
            name="fxRateMode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.fxRateMode')}</FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="gap-sm flex flex-row"
                  >
                    <label className="gap-xs flex cursor-pointer items-center text-sm">
                      <RadioGroupItem value={FxRateMode.AUTO} />
                      {tFxMode(FxRateMode.AUTO)}
                    </label>
                    <label className="gap-xs flex cursor-pointer items-center text-sm">
                      <RadioGroupItem value={FxRateMode.MANUAL} />
                      {tFxMode(FxRateMode.MANUAL)}
                    </label>
                  </RadioGroup>
                </FormControl>
                <FormMessage render={renderValidation} />
              </FormItem>
            )}
          />
        ) : null}

        {/* Manual FX rate — only when MANUAL + non-TRY */}
        {showManualFxRate ? (
          <FormField
            control={form.control}
            name="manualFxRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.manualFxRate')}</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder={t('fields.manualFxRatePlaceholder')}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  />
                </FormControl>
                <FormMessage render={renderValidation} />
              </FormItem>
            )}
          />
        ) : null}

        {/* Note */}
        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.note')}</FormLabel>
              <FormControl>
                <Textarea
                  placeholder={t('fields.notePlaceholder')}
                  rows={3}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value || null)}
                />
              </FormControl>
              <FormMessage render={renderValidation} />
            </FormItem>
          )}
        />

        {/* Actions */}
        <div className="gap-sm flex justify-end">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '…' : t('submit')}
          </Button>
        </div>
      </form>
    </Form>
  );
}

/**
 * Converts a CostProfile response from the API into CostProfileFormValues
 * for pre-filling the edit form.
 */
export function profileToFormValues(profile: CostProfile): CostProfileFormValues {
  return {
    name: profile.name,
    type: profile.type as CostProfileType,
    currency: profile.currency as Currency,
    amount: profile.amount,
    vatRate: profile.vatRate,
    fxRateMode: profile.fxRateMode as FxRateMode,
    manualFxRate: profile.manualFxRate,
    note: profile.note,
  };
}
