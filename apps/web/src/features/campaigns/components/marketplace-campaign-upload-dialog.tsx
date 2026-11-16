'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { DiscountType } from '@pazarsync/db/enums';
import { WORKBOOK_UPLOAD_MAX_BYTES, WORKBOOK_UPLOAD_MAX_MB } from '@pazarsync/utils';

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
import { Form } from '@/components/ui/form';

import {
  campaignConfigFormSchema,
  type CampaignConfigFormInput,
  type CampaignConfigFormValues,
} from '../lib/marketplace-campaign-config';
import {
  MarketplaceCampaignConfigFields,
  placedConfigFields,
} from './marketplace-campaign-config-fields';
import { UploadUnplacedIssues } from './upload-unplaced-issues';

/**
 * Maps a backend file-rejection code to its localized message key bucket. Campaign-specific
 * codes are `EMPTY_CAMPAIGN_FILE` / `INVALID_CAMPAIGN_FORMAT`; the rest are the shared upload
 * codes every vertical raises.
 */
function useFileErrorMessage(): (code: string | null | undefined) => string | null {
  const t = useTranslations('marketplaceCampaignsPage.upload.errors');
  return (code) => {
    switch (code) {
      case null:
      case undefined:
        return null;
      case 'NOT_XLSX':
      case 'CORRUPT_FILE':
      case 'UNSAFE_CONTENT':
        return t('notReadable');
      case 'EMPTY_CAMPAIGN_FILE':
        return t('empty');
      case 'ROW_CAP_EXCEEDED':
      case 'COL_CAP_EXCEEDED':
      case 'PAYLOAD_TOO_LARGE':
        return t('tooLarge');
      case 'SHEET_NOT_FOUND':
      case 'INVALID_CAMPAIGN_FORMAT':
      case 'MISSING_REQUIRED_HEADERS':
      case 'AMBIGUOUS_HEADERS':
        return t('wrongFormat');
      default:
        return t('generic');
    }
  };
}

export interface MarketplaceCampaignUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fires on submit with the validated config (the funding rate resolved to an explicit value),
   * the chosen file, and the optional campaign name.
   */
  onSubmit: (config: CampaignConfigFormValues, file: File, name?: string) => void;
  /** True while the import request is in flight (drives the submit button). */
  submitting?: boolean;
  /** Backend file-rejection code (from `extractFileErrorCode`), shown inline. */
  errorCode?: string | null;
  /**
   * The import mutation's error. On a `VALIDATION_ERROR` its `problem.errors[]` are walked into
   * inline field messages by {@link MarketplaceCampaignConfigFields}; an issue no input owns is
   * listed under the dropzone.
   */
  submitError?: Error | null;
  /** Clears the last import error when the seller picks a different file. */
  onResetError?: () => void;
}

/**
 * Excel-upload dialog over the Kampanyalar list. The participation sheet Trendyol hands out says
 * nothing about the campaign's terms — the kurgu, its parameters and Trendyol's funding share
 * are only visible in the panel — so the seller sets them here: the dropzone sits above, then
 * the optional campaign name, the kurgu, its parameters, the funding rate and the campaign
 * window. Submitting creates the campaign and the caller routes on to its detail screen.
 */
export function MarketplaceCampaignUploadDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting = false,
  errorCode,
  submitError,
  onResetError,
}: MarketplaceCampaignUploadDialogProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.upload');
  const tUpload = useTranslations('campaignUpload');
  const tCommon = useTranslations('common');
  const fileErrorMessage = useFileErrorMessage();

  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState('');

  const form = useForm<CampaignConfigFormInput, unknown, CampaignConfigFormValues>({
    resolver: zodResolver(campaignConfigFormSchema),
    defaultValues: { discountType: DiscountType.NET },
  });
  // The kurgu decides which parameters have an input, so it decides which issues are unplaced.
  const discountType = useWatch({ control: form.control, name: 'discountType' });

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

  const handleValid = (values: CampaignConfigFormValues): void => {
    if (file === null) return;
    const trimmedName = name.trim();
    onSubmit(values, file, trimmedName === '' ? undefined : trimmedName);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="marketplace-campaign-upload-modal flex flex-col overflow-hidden">
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
                  maxSize={WORKBOOK_UPLOAD_MAX_BYTES}
                  prompt={t('prompt')}
                  hint={t('hint', { maxMb: WORKBOOK_UPLOAD_MAX_MB })}
                  ctaLabel={t('cta')}
                  errorWrongType={tUpload('fileErrors.wrongType')}
                  errorTooLarge={tUpload('fileErrors.tooLarge', { maxMb: WORKBOOK_UPLOAD_MAX_MB })}
                  removeLabel={tUpload('removeFile')}
                  error={fileErrorMessage(errorCode)}
                  onChange={(next) => {
                    setFile(next);
                    onResetError?.();
                  }}
                />
                <UploadUnplacedIssues
                  error={submitError}
                  placedFields={['file', ...placedConfigFields(discountType)]}
                />

                <MarketplaceCampaignConfigFields
                  form={form}
                  nameValue={name}
                  onNameChange={setName}
                  submitError={submitError}
                />
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
