'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import { DiscountType } from '@pazarsync/db/enums';

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

import { discountConfigFormSchema, type DiscountConfigFormValues } from '../lib/discount-config';
import { DiscountConfigFields } from './discount-config-fields';

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

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
   * inline field messages by {@link DiscountConfigFields}.
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
  errorCode,
  submitError,
  onResetError,
}: DiscountUploadDialogProps): React.ReactElement {
  const t = useTranslations('discountsPage.upload');
  const tCommon = useTranslations('common');
  const fileErrorMessage = useFileErrorMessage();

  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState('');

  const form = useForm<DiscountConfigFormValues>({
    resolver: zodResolver(discountConfigFormSchema),
    defaultValues: { discountType: DiscountType.NET },
  });

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
