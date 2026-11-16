'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { type UseFormReturn } from 'react-hook-form';

import type { DiscountType } from '@pazarsync/db/enums';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

import { useServerFieldErrors } from '../hooks/use-server-field-errors';
import { visibleConfigFields } from '../lib/discount-config';
import {
  CAMPAIGN_DISCOUNT_TYPES,
  type CampaignConfigFormInput,
  type CampaignConfigFormValues,
} from '../lib/marketplace-campaign-config';
import { validationIssues } from '../lib/upload-error';
import {
  ConfigNameField,
  ConfigParameterGrid,
  ConfigTypeField,
  ConfigWindowFields,
  useConfigFieldErrorMessage,
} from './campaign-config-sections';

// The RHF-backed form fields — a backend VALIDATION_ERROR whose `field` is one of these maps to
// a `form.setError`; `file` (owned by the upload dialog's file error) and `name` (local
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
  'trendyolFundingPct',
  'startsAt',
  'endsAt',
] as const satisfies readonly (keyof CampaignConfigFormInput)[];

/**
 * The fields of this section that have a message slot on screen for the given kurgu: the name,
 * the kurgu picker, ONLY the parameters that kurgu shows, the funding rate and the window. A
 * parameter the kurgu hides has no slot (its `form.setError` would be invisible), so the dialog
 * lists its issue itself (`UploadUnplacedIssues`).
 */
export function placedConfigFields(discountType: DiscountType): readonly string[] {
  return [
    'name',
    'discountType',
    ...visibleConfigFields(discountType),
    'trendyolFundingPct',
    'startsAt',
    'endsAt',
  ];
}

/** The funding-rate codes on top of the shared kurgu buckets. */
function useCampaignFieldErrorMessage(): (code: string) => string {
  const t = useTranslations('marketplaceCampaignsPage.upload.fieldErrors');
  const configFieldError = useConfigFieldErrorMessage();
  return (code) => {
    switch (code) {
      case 'INVALID_FUNDING_PCT':
        return t('fundingDecimal');
      case 'FUNDING_PCT_OVER_100':
        return t('fundingOver100');
      default:
        return configFieldError(code);
    }
  };
}

export interface MarketplaceCampaignConfigFieldsProps {
  /** The RHF form driving the config (kurgu + parameters + funding rate + window). */
  form: UseFormReturn<CampaignConfigFormInput, unknown, CampaignConfigFormValues>;
  /** The optional campaign name — local state, like the İndirimler form's list name. */
  nameValue: string;
  onNameChange: (value: string) => void;
  /**
   * The submit mutation's error. On a `VALIDATION_ERROR` its `problem.errors[]` are walked into
   * inline field messages — since `VALIDATION_ERROR` is globally silenced, this is the ONLY
   * feedback for a config/name 422.
   */
  submitError?: Error | null;
}

/**
 * The config section of the Kampanyalar upload (and later edit) form: an optional campaign name,
 * the five-kurgu picker, ONLY the parameters that kurgu uses, Trendyol's funding rate, and the
 * required campaign window — the kurgu sections are the ones İndirimler uses. MUST be rendered
 * inside a `<Form {...form}>` provider (the caller owns the `<form>` element and submit).
 */
export function MarketplaceCampaignConfigFields({
  form,
  nameValue,
  onNameChange,
  submitError,
}: MarketplaceCampaignConfigFieldsProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.upload');
  const fieldError = useCampaignFieldErrorMessage();

  // Derived, not mirrored into state — clears once the next submit's error has no name issue.
  const nameServerError = React.useMemo<string | null>(
    () => validationIssues(submitError).find((issue) => issue.field === 'name')?.code ?? null,
    [submitError],
  );

  // A new kurgu keeps the type, Trendyol's funding rate and the campaign window; only the
  // previous type's parameters go. See ConfigParameterGrid for why this reset is needed.
  const resetParameters = React.useCallback(() => {
    const { discountType, trendyolFundingPct, startsAt, endsAt } = form.getValues();
    form.reset({ discountType, trendyolFundingPct, startsAt, endsAt });
  }, [form]);

  // Backend VALIDATION_ERROR field issues → inline messages (see DiscountConfigFields for the
  // full rationale; an effect is required because setError writes into external RHF state).
  useServerFieldErrors(form, submitError, RHF_FIELD_NAMES);

  return (
    <div className="gap-md flex flex-col">
      <ConfigNameField
        label={t('name')}
        value={nameValue}
        onChange={onNameChange}
        serverError={nameServerError}
      />
      <ConfigTypeField
        label={t('typeLabel')}
        typeOptions={CAMPAIGN_DISCOUNT_TYPES}
        onTypeChange={resetParameters}
      />
      <ConfigParameterGrid />

      <FormField
        control={form.control}
        name="trendyolFundingPct"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('fundingLabel')}</FormLabel>
            <FormControl>
              <Input
                inputMode="decimal"
                value={field.value ?? ''}
                // A cleared input keeps '' (a seeded rate must be clearable); the schema reads an
                // empty rate as 0.
                onChange={(event) => field.onChange(event.target.value)}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
                invalid={fieldState.error !== undefined}
              />
            </FormControl>
            <FormDescription>{t('fundingHint')}</FormDescription>
            <FormMessage render={fieldError} />
          </FormItem>
        )}
      />

      <ConfigWindowFields />
    </div>
  );
}
