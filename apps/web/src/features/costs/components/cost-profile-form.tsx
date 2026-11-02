'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { CostProfileType } from '../types/cost-profile.types';
import type { CostProfile } from '../types/cost-profile.types';
import {
  costProfileFormSchema,
  type CostProfileFormValues,
  VAT_RATE_OPTIONS,
} from '../validation/cost-profile.schema';

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
] as const);

type ValidationCode = 'nameRequired' | 'nameTooLong' | 'amountRequired' | 'amountNegative';

function knownValidationCode(value: string | undefined): ValidationCode | undefined {
  if (value === undefined) return undefined;
  return VALIDATION_CODES.has(value as ValidationCode) ? (value as ValidationCode) : undefined;
}

interface CostProfileFormProps {
  /** When editing an existing profile, supply it for pre-filling. */
  initialValues?: Partial<CostProfileFormValues>;
  onSubmit: (values: CostProfileFormValues) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

/**
 * Shared form for creating and editing cost profiles.
 *
 * Used by `CostProfileCreateDialog` (Costs page CTA) and the detail tab.
 * Fields: name, type, amount, vatRate, note.
 */
export function CostProfileForm({
  initialValues,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: CostProfileFormProps): React.ReactElement {
  const t = useTranslations('costs.form');
  const tTypes = useTranslations('costs.types');
  const tValidation = useTranslations('costs.form.validation');

  // Translate the schema's error code (costs.form.validation.<code>) for the
  // canonical FormMessage; unknown codes pass through (zod-internal messages).
  const renderValidation = (code: string): string => {
    const known = knownValidationCode(code);
    return known !== undefined ? tValidation(known) : code;
  };

  const form = useForm<CostProfileFormValues>({
    resolver: zodResolver(costProfileFormSchema),
    defaultValues: {
      name: initialValues?.name ?? '',
      type: initialValues?.type ?? CostProfileType.COGS,
      amountGross: initialValues?.amountGross ?? '',
      vatRate: initialValues?.vatRate ?? 18,
      note: initialValues?.note ?? null,
    },
  });

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

        {/* Amount */}
        <FormField
          control={form.control}
          name="amountGross"
          render={({ field }) => (
            <FormItem>
              {/* GROSS konvansiyon (2026-06-16): maliyet KDV-dahil girilir. Etiket
                  + yardım metni satıcıyı tedarikçi faturasındaki KDV-dahil tutara yönlendirir. */}
              <FormLabel>{t('fields.amountGross')}</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder={t('fields.amountPlaceholder')}
                  {...field}
                />
              </FormControl>
              <FormDescription>{t('fields.amountGrossHelp')}</FormDescription>
              <FormMessage render={renderValidation} />
            </FormItem>
          )}
        />

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
    amountGross: profile.amountGross,
    vatRate: profile.vatRate,
    note: profile.note,
  };
}
