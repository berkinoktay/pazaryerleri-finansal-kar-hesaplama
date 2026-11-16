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
import { discountConfigFormSchema, type DiscountConfigFormValues } from '../lib/discount-config';
import { DiscountConfigFields, placedConfigFields } from './discount-config-fields';
import { UploadUnplacedIssues } from './upload-unplaced-issues';

export interface DiscountUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires on submit with the validated config, the chosen file, and the optional list name. */
  onSubmit: (config: DiscountConfigFormValues, file: File, name?: string) => void;
  /** True while the import request is in flight (drives the submit button). */
  submitting?: boolean;
  /**
   * The import mutation's error. Its file rejection is shown on the dropzone; on a
   * `VALIDATION_ERROR` its other `problem.errors[]` are walked into inline field messages by
   * {@link DiscountConfigFields}, and an issue no input owns is listed under the dropzone.
   */
  submitError?: Error | null;
  /** Clears the last import error when the seller picks a different file. */
  onResetError?: () => void;
}

/**
 * Excel-upload dialog over the İndirimler list. Unlike the other campaign upload dialogs (which
 * only take a file), the discount kurgu (type + its per-type parameters) is NOT in the sheet —
 * Trendyol reuses the SAME product-selection file for every discount type — so the seller sets
 * it here through the shared {@link DiscountConfigFields} section: the dropzone sits above, then
 * the optional list name, the discount type, its parameters, and the optional order-limit +
 * date-range block. Submitting creates the list and the caller routes on to the detail screen.
 */
export function DiscountUploadDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting = false,
  submitError,
  onResetError,
}: DiscountUploadDialogProps): React.ReactElement {
  const t = useTranslations('discountsPage.upload');
  const tUpload = useTranslations('campaignUpload');
  const tCommon = useTranslations('common');
  const fileErrorMessage = useWorkbookErrorMessage(WORKBOOK_PAGES.DISCOUNT_LIST);

  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState('');

  const form = useForm<DiscountConfigFormValues>({
    resolver: zodResolver(discountConfigFormSchema),
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

  const handleValid = (values: DiscountConfigFormValues): void => {
    if (file === null) return;
    const trimmedName = name.trim();
    onSubmit(values, file, trimmedName === '' ? undefined : trimmedName);
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

                <DiscountConfigFields
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
