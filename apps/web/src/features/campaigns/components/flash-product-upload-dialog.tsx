'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

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

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Maps a backend file-rejection code to its localized message key bucket. Flash-specific
 * codes are `EMPTY_FLASH_FILE` / `INVALID_FLASH_FORMAT`; the rest are the shared upload
 * codes every vertical raises.
 */
function useFileErrorMessage(): (code: string | null | undefined) => string | null {
  const t = useTranslations('flashProductsPage.upload.errors');
  return (code) => {
    switch (code) {
      case null:
      case undefined:
        return null;
      case 'NOT_XLSX':
      case 'CORRUPT_FILE':
        return t('notReadable');
      case 'EMPTY_FLASH_FILE':
        return t('empty');
      case 'ROW_CAP_EXCEEDED':
      case 'COL_CAP_EXCEEDED':
      case 'PAYLOAD_TOO_LARGE':
        return t('tooLarge');
      case 'SHEET_NOT_FOUND':
      case 'INVALID_FLASH_FORMAT':
      case 'MISSING_REQUIRED_HEADERS':
      case 'AMBIGUOUS_HEADERS':
        return t('wrongFormat');
      default:
        return t('generic');
    }
  };
}

export interface FlashProductUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires on submit with the chosen file. */
  onFile: (file: File) => void;
  /** True while the import request is in flight (drives the submit button). */
  submitting?: boolean;
  /** Backend file-rejection code (from `extractFileErrorCode`), shown inline. */
  errorCode?: string | null;
  /** Clears the last import error when the seller picks a different file. */
  onResetError?: () => void;
}

/**
 * Excel-upload dialog over the Flash Products list. A focused mini-form that keeps the list
 * in context (vs a full-screen state): the dropzone plus a short "how it works" guide.
 * Unlike the Advantage upload there is NO commission-source picker — the reduced commission
 * is AUTO-resolved per row from the store's commission-tariff data. Submitting creates the
 * upload and the caller routes on to the detail screen.
 */
export function FlashProductUploadDialog({
  open,
  onOpenChange,
  onFile,
  submitting = false,
  errorCode,
  onResetError,
}: FlashProductUploadDialogProps): React.ReactElement {
  const t = useTranslations('flashProductsPage.upload');
  const tCommon = useTranslations('common');
  const fileErrorMessage = useFileErrorMessage();

  const [file, setFile] = React.useState<File | null>(null);

  const handleOpenChange = (next: boolean): void => {
    // Reset the form when the dialog closes so reopening starts clean.
    if (!next) setFile(null);
    onOpenChange(next);
  };

  const handleSubmit = (): void => {
    if (file === null) return;
    onFile(file);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

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

          <div className="border-border bg-surface-subtle gap-sm p-md flex flex-col rounded-lg border">
            <p className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
              {t('stepsTitle')}
            </p>
            <ol className="gap-sm flex flex-col">
              {(['step1', 'step2', 'step3'] as const).map((key, index) => (
                <li key={key} className="gap-sm flex items-start">
                  <span className="bg-primary-soft text-primary-soft-foreground text-2xs flex size-5 shrink-0 items-center justify-center rounded-full font-semibold tabular-nums">
                    {index + 1}
                  </span>
                  <span className="text-sm">{t(key)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{tCommon('cancel')}</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={file === null} loading={submitting}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
