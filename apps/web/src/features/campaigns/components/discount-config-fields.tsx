'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { type UseFormReturn } from 'react-hook-form';

import { DiscountType } from '@pazarsync/db/enums';

import { visibleConfigFields, type DiscountConfigFormValues } from '../lib/discount-config';
import { validationIssues } from '../lib/upload-error';
import {
  ConfigNameField,
  ConfigParameterGrid,
  ConfigTypeField,
  ConfigWindowFields,
} from './campaign-config-sections';

// Display order for the discount-type picker (all six kurgu).
const DISCOUNT_TYPE_OPTIONS: readonly DiscountType[] = [
  DiscountType.NET,
  DiscountType.CONDITIONAL_BASKET,
  DiscountType.CONDITIONAL_QUANTITY,
  DiscountType.BUY_X_PAY_Y,
  DiscountType.NTH_PRODUCT,
  DiscountType.CODE,
];

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
  'startsAt',
  'endsAt',
] as const satisfies readonly (keyof DiscountConfigFormValues)[];

function isRhfFieldName(field: string): field is (typeof RHF_FIELD_NAMES)[number] {
  return RHF_FIELD_NAMES.some((name) => name === field);
}

/**
 * The fields of this section that have a message slot on screen for the given kurgu: the name,
 * the kurgu picker, ONLY the parameters that kurgu shows, and the window. A parameter the kurgu
 * hides has no slot (its `form.setError` would be invisible), so the dialog lists its issue
 * itself (`UploadUnplacedIssues`).
 */
export function placedConfigFields(discountType: DiscountType): readonly string[] {
  return ['name', 'discountType', ...visibleConfigFields(discountType), 'startsAt', 'endsAt'];
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
 * name, the discount type picker (all six kurgu), ONLY the parameters that type uses, and the
 * required campaign-window (start + end) date group — composed from the kurgu sections Kampanyalar
 * shares. Both the upload dialog (which adds the file dropzone above) and the config-edit dialog
 * render it, so the backend server-error plumbing lives in ONE place. MUST be rendered inside a
 * `<Form {...form}>` provider (the caller owns the `<form>` element and submit).
 */
export function DiscountConfigFields({
  form,
  nameValue,
  onNameChange,
  submitError,
}: DiscountConfigFieldsProps): React.ReactElement {
  const t = useTranslations('discountsPage.upload');

  // `name` is local state, so its backend error is DERIVED from the mutation error rather than
  // mirrored into state (no setState-in-effect). It clears when the next submit's error no longer
  // carries a name issue.
  const nameServerError = React.useMemo<string | null>(
    () => validationIssues(submitError).find((issue) => issue.field === 'name')?.code ?? null,
    [submitError],
  );

  // A new kurgu keeps only the type and the campaign window; the previous type's parameters go.
  // See ConfigParameterGrid for why this reset (plus the grid's keyed remount) is needed.
  const resetParameters = React.useCallback(() => {
    const { discountType, startsAt, endsAt } = form.getValues();
    form.reset({ discountType, startsAt, endsAt });
  }, [form]);

  // Surface backend VALIDATION_ERROR field issues inline (the global toast pipeline silences
  // VALIDATION_ERROR). Config fields are pushed into RHF via form.setError → FormMessage; `name`
  // is derived above; `file` belongs to the upload dialog's file error, so no issue renders
  // twice. The client zod schema mirrors the backend gate 1:1, so in practice this only fires for
  // backend-only checks or a genuine client/backend drift. (Canonical pattern from
  // apps/web/CLAUDE.md — an effect is required because setError writes into external RHF state.)
  React.useEffect(() => {
    for (const issue of validationIssues(submitError)) {
      if (isRhfFieldName(issue.field)) {
        form.setError(issue.field, { type: 'server', message: issue.code });
      }
    }
  }, [submitError, form]);

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
        typeOptions={DISCOUNT_TYPE_OPTIONS}
        onTypeChange={resetParameters}
      />
      <ConfigParameterGrid />
      <ConfigWindowFields />
    </div>
  );
}
