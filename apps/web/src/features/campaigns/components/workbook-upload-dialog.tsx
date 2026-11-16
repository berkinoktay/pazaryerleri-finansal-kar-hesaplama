'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { DiscountType } from '@pazarsync/db/enums';
import type { WorkbookPage } from '@pazarsync/utils';

import { Form } from '@/components/ui/form';

import type { WorkbookImportInput } from '../api/workbook-endpoints';
import { useCommissionTariffList } from '../hooks/use-commission-tariff-list';
import { discountConfigFormSchema, type DiscountConfigFormValues } from '../lib/discount-config';
import {
  campaignConfigFormSchema,
  type CampaignConfigFormInput,
  type CampaignConfigFormValues,
} from '../lib/marketplace-campaign-config';
import { validationIssues } from '../lib/upload-error';
import { WORKBOOK_VERTICALS, type WorkbookUploadExtras } from '../lib/workbook-verticals';
import {
  CATEGORY_COMMISSION_SOURCE,
  CommissionSourcePicker,
  resolveCommissionSource,
} from './commission-source-picker';
import {
  DiscountConfigFields,
  placedConfigFields as placedDiscountFields,
} from './discount-config-fields';
import {
  MarketplaceCampaignConfigFields,
  placedConfigFields as placedCampaignFields,
} from './marketplace-campaign-config-fields';
import { WorkbookUploadFrame } from './workbook-upload-frame';

export interface WorkbookUploadDialogProps {
  page: WorkbookPage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The store the upload goes to (the commission source picker lists its tariffs). */
  scope: { orgId: string; storeId: string };
  /** Fires on submit with the picked file and the page's own form fields. */
  onSubmit: (input: WorkbookImportInput) => void;
  /** True while the import request is in flight (drives the submit button). */
  submitting?: boolean;
  /**
   * The import mutation's error: its file refusal is shown on the dropzone, its field issues
   * under the input that owns them, and any other field issue under the dropzone.
   */
  submitError?: Error | null;
  /** Clears the last import error (a new file is picked, or the dialog closes). */
  onResetError?: () => void;
}

/** The frame props an extras form passes through unchanged. */
function frameProps({
  page,
  open,
  onOpenChange,
  submitting,
  submitError,
  onResetError,
}: WorkbookUploadDialogProps): Pick<
  React.ComponentProps<typeof WorkbookUploadFrame>,
  'page' | 'open' | 'onOpenChange' | 'submitting' | 'submitError' | 'onResetError'
> {
  return { page, open, onOpenChange, submitting, submitError, onResetError };
}

/** The list name of an upload: trimmed, and left out when empty. */
function nameField(name: string): { name?: string } {
  const trimmedName = name.trim();
  return trimmedName === '' ? {} : { name: trimmedName };
}

/** The file is the only field of these pages. */
const FILE_ONLY_FIELDS: readonly string[] = ['file'];

/** The picker owns the message slot of the commission source. */
const COMMISSION_SOURCE_FIELDS: readonly string[] = ['file', 'commissionSourceTariffId'];

/** A page that asks for the file only. */
function FileOnlyUploadForm(props: WorkbookUploadDialogProps): React.ReactElement {
  const { onSubmit } = props;
  return (
    <WorkbookUploadFrame
      {...frameProps(props)}
      placedFields={FILE_ONLY_FIELDS}
      extrasReady
      onSubmitFile={(file) => onSubmit({ file, fields: {} })}
      onClosed={() => undefined}
    />
  );
}

/**
 * The Advantage upload: the file and the commission tariff that supplies the reduced rates (or
 * the category commission). Submit waits for a choice: the seller's, or the default derived from
 * the store's tariffs.
 */
function CommissionSourceUploadForm(props: WorkbookUploadDialogProps): React.ReactElement {
  const { scope, onSubmit, submitError } = props;
  const commissionList = useCommissionTariffList(scope.orgId, scope.storeId);
  // The seller's EXPLICIT choice; undefined until they pick, and again after a close, so the
  // default re-derives against the latest list on reopen.
  const [choice, setChoice] = React.useState<string | undefined>(undefined);
  const value = resolveCommissionSource(choice, commissionList.data, commissionList.isLoading);
  const sourceError =
    validationIssues(submitError).find((issue) => issue.field === 'commissionSourceTariffId')
      ?.code ?? null;

  return (
    <WorkbookUploadFrame
      {...frameProps(props)}
      placedFields={COMMISSION_SOURCE_FIELDS}
      extrasReady={value !== undefined}
      onSubmitFile={(file) => {
        if (value === undefined) return;
        // The category choice pins no tariff, so the field is left out.
        onSubmit({
          file,
          fields: value === CATEGORY_COMMISSION_SOURCE ? {} : { commissionSourceTariffId: value },
        });
      }}
      onClosed={() => setChoice(undefined)}
    >
      <CommissionSourcePicker
        orgId={scope.orgId}
        storeId={scope.storeId}
        value={value}
        onChange={setChoice}
        serverError={sourceError}
      />
    </WorkbookUploadFrame>
  );
}

/**
 * The Discounts upload: the file, an optional list name and the discount configuration, which
 * the sheet does not carry. The config is validated by its schema at submit.
 */
function DiscountConfigUploadForm(props: WorkbookUploadDialogProps): React.ReactElement {
  const { onSubmit, submitError } = props;
  const [name, setName] = React.useState('');
  const form = useForm<DiscountConfigFormValues>({
    resolver: zodResolver(discountConfigFormSchema),
    defaultValues: { discountType: DiscountType.NET },
  });
  // The discount type decides which parameters have an input, so it decides which are placed.
  const discountType = useWatch({ control: form.control, name: 'discountType' });

  return (
    <WorkbookUploadFrame
      {...frameProps(props)}
      placedFields={['file', ...placedDiscountFields(discountType)]}
      extrasReady
      onSubmitFile={(file) => {
        void form.handleSubmit((values) =>
          onSubmit({ file, fields: { ...nameField(name), ...values } }),
        )();
      }}
      onClosed={() => {
        form.reset({ discountType: DiscountType.NET });
        setName('');
      }}
    >
      <Form {...form}>
        <DiscountConfigFields
          form={form}
          nameValue={name}
          onNameChange={setName}
          submitError={submitError}
        />
      </Form>
    </WorkbookUploadFrame>
  );
}

/**
 * The Campaigns upload: the file, an optional campaign name and the campaign terms (the
 * discount configuration and Trendyol's funding rate), which the sheet does not carry.
 */
function CampaignConfigUploadForm(props: WorkbookUploadDialogProps): React.ReactElement {
  const { onSubmit, submitError } = props;
  const [name, setName] = React.useState('');
  const form = useForm<CampaignConfigFormInput, unknown, CampaignConfigFormValues>({
    resolver: zodResolver(campaignConfigFormSchema),
    defaultValues: { discountType: DiscountType.NET },
  });
  // The discount type decides which parameters have an input, so it decides which are placed.
  const discountType = useWatch({ control: form.control, name: 'discountType' });

  return (
    <WorkbookUploadFrame
      {...frameProps(props)}
      placedFields={['file', ...placedCampaignFields(discountType)]}
      extrasReady
      onSubmitFile={(file) => {
        void form.handleSubmit((values) =>
          onSubmit({ file, fields: { ...nameField(name), ...values } }),
        )();
      }}
      onClosed={() => {
        form.reset({ discountType: DiscountType.NET });
        setName('');
      }}
    >
      <Form {...form}>
        <MarketplaceCampaignConfigFields
          form={form}
          nameValue={name}
          onNameChange={setName}
          submitError={submitError}
        />
      </Form>
    </WorkbookUploadFrame>
  );
}

/** The form of each kind of page fields (`WORKBOOK_VERTICALS[page].extras`). */
const EXTRAS_FORMS: Readonly<
  Record<WorkbookUploadExtras, React.ComponentType<WorkbookUploadDialogProps>>
> = {
  none: FileOnlyUploadForm,
  commissionSource: CommissionSourceUploadForm,
  discountConfig: DiscountConfigUploadForm,
  campaignConfig: CampaignConfigUploadForm,
};

/**
 * The upload dialog of every campaign page that accepts a marketplace workbook. The page's
 * vertical picks the fields it asks for besides the file; the shared frame renders the rest.
 * Submitting hands the file and the fields to the caller, which runs the import and routes on
 * to the new record.
 */
export function WorkbookUploadDialog(props: WorkbookUploadDialogProps): React.ReactElement {
  const ExtrasForm = EXTRAS_FORMS[WORKBOOK_VERTICALS[props.page].extras];
  return <ExtrasForm {...props} />;
}
