'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { DiscountType } from '@pazarsync/db/enums';
import {
  WORKBOOK_PAGES,
  WORKBOOK_UPLOAD_MAX_BYTES,
  WORKBOOK_UPLOAD_MAX_MB,
} from '@pazarsync/utils';

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

import { useWorkbookErrorMessage } from '../hooks/use-workbook-error-message';
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
  /**
   * The import mutation's error. Its file rejection is shown on the dropzone; on a
   * `VALIDATION_ERROR` its other `problem.errors[]` are walked into inline field messages by
   * {@link MarketplaceCampaignConfigFields}, and an issue no input owns is listed under the
   * dropzone.
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
  submitError,
  onResetError,
}: MarketplaceCampaignUploadDialogProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.upload');
  const tUpload = useTranslations('campaignUpload');
  const tCommon = useTranslations('common');
  const fileErrorMessage = useWorkbookErrorMessage(WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST);

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
                  error={fileErrorMessage(submitError)}
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
