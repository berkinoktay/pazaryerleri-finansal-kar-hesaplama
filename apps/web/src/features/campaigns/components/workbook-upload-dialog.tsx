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
import {
  COMMISSION_SOURCE_FIELD,
  INVALID_COMMISSION_SOURCE,
  UPLOAD_NAME_FIELD,
  validationIssues,
} from '../lib/upload-error';
import { isUploadNameTooLong } from '../lib/upload-name';
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
function nameField(name: string): Partial<Record<typeof UPLOAD_NAME_FIELD, string>> {
  const trimmedName = name.trim();
  return trimmedName === '' ? {} : { [UPLOAD_NAME_FIELD]: trimmedName };
}

/** The file is the only field of these pages. */
const FILE_ONLY_FIELDS: readonly string[] = ['file'];

/** The picker owns the message slot of the commission source. */
const COMMISSION_SOURCE_FIELDS: readonly string[] = ['file', COMMISSION_SOURCE_FIELD];

const NO_REJECTED_SOURCES: ReadonlySet<string> = new Set();

/** The set with `id` added; the same set when it already holds it. */
function withId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return ids.has(id) ? ids : new Set([...ids, id]);
}

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
  // The seller's EXPLICIT choice (a tariff id or the category sentinel); undefined until they
  // pick, and again after a close, so the default re-derives against the latest list on reopen.
  // A choice the server refused, or one no longer in the loaded list, is dropped by
  // `resolveCommissionSource` rather than cleared here.
  const [choice, setChoice] = React.useState<string | undefined>(undefined);
  // The tariff id of the last submit; undefined for the category choice or before any submit.
  const [submittedSource, setSubmittedSource] = React.useState<string | undefined>(undefined);
  // Every tariff id the server refused as a commission source, kept until the dialog closes so
  // a refusal outlives the error being cleared (a new file, a new source, a new submit) even
  // while the invalidated tariff list is still refetching. A set, so two refused weeks never
  // take turns as the default.
  const [rejectedSources, setRejectedSources] =
    React.useState<ReadonlySet<string>>(NO_REJECTED_SOURCES);
  const sourceError =
    validationIssues(submitError).find((issue) => issue.field === COMMISSION_SOURCE_FIELD)?.code ??
    null;
  // The refusal on screen counts before it is recorded.
  const refusedNow =
    sourceError === INVALID_COMMISSION_SOURCE && submittedSource !== undefined
      ? submittedSource
      : undefined;
  const rejectedIds =
    refusedNow === undefined ? rejectedSources : withId(rejectedSources, refusedNow);
  const value = resolveCommissionSource(
    choice,
    commissionList.data,
    commissionList.isLoading,
    rejectedIds,
  );

  // Records the refused source before the import error goes away. Runs in event handlers only.
  const rememberRejection = (): void => {
    if (refusedNow === undefined) return;
    setRejectedSources((previous) => withId(previous, refusedNow));
  };
  const resetError = (): void => {
    // A reset while the import is in flight detaches the mutation and drops the success callback
    // that closes the dialog and routes to the new record. The frame locks its own reset paths;
    // this covers the picker, which stays usable while importing.
    if (props.submitting === true) return;
    rememberRejection();
    props.onResetError?.();
  };

  return (
    <WorkbookUploadFrame
      {...frameProps(props)}
      onResetError={resetError}
      placedFields={COMMISSION_SOURCE_FIELDS}
      extrasReady={value !== undefined}
      onSubmitFile={(file) => {
        if (value === undefined) return;
        // A new submit clears the import error without a reset, so the refusal is kept here too.
        rememberRejection();
        // The category choice pins no tariff, so the field is left out.
        const tariffId = value === CATEGORY_COMMISSION_SOURCE ? undefined : value;
        setSubmittedSource(tariffId);
        onSubmit({
          file,
          fields: tariffId === undefined ? {} : { [COMMISSION_SOURCE_FIELD]: tariffId },
        });
      }}
      onClosed={() => {
        setChoice(undefined);
        setSubmittedSource(undefined);
        setRejectedSources(NO_REJECTED_SOURCES);
      }}
    >
      <CommissionSourcePicker
        orgId={scope.orgId}
        storeId={scope.storeId}
        value={value}
        onChange={(next) => {
          setChoice(next);
          // A source change clears the server error.
          resetError();
        }}
        serverError={sourceError}
        refusedIds={rejectedIds}
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
        // Validate the config first, so its errors show in the same click as the name's.
        void form.handleSubmit((values) => {
          // The name field already shows why; a name the API would refuse is never sent.
          if (isUploadNameTooLong(name)) return;
          onSubmit({ file, fields: { ...nameField(name), ...values } });
        })();
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
        // Validate the config first, so its errors show in the same click as the name's.
        void form.handleSubmit((values) => {
          // The name field already shows why; a name the API would refuse is never sent.
          if (isUploadNameTooLong(name)) return;
          onSubmit({ file, fields: { ...nameField(name), ...values } });
        })();
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
