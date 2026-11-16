'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

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

import { useWorkbookErrorMessage } from '../hooks/use-workbook-error-message';
import { UploadUnplacedIssues } from './upload-unplaced-issues';

const STEP_KEYS = ['step1', 'step2', 'step3'] as const;

/** The dropzone is this dialog's only message slot; any other field issue is listed under it. */
const PLACED_FIELDS: readonly string[] = ['file'];

export interface PlusTariffUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires on submit with the chosen file. */
  onFile: (file: File) => void;
  /** True while the import request is in flight (drives the submit button). */
  submitting?: boolean;
  /**
   * The import mutation's error: its file rejection is shown on the dropzone, and its field
   * issues on anything but the file are listed under it.
   */
  submitError?: Error | null;
  /** Clears the last import error when the seller picks a different file. */
  onResetError?: () => void;
}

/**
 * Excel-upload dialog over the Plus tariff list. A focused mini-form that keeps
 * the list in context (vs a full-screen state): the dropzone plus a short "how
 * it works" guide. Submitting creates the tariff and the caller routes on to the
 * detail screen. The period dates are read from the file itself by the backend,
 * so the dialog asks only for the file.
 */
export function PlusTariffUploadDialog({
  open,
  onOpenChange,
  onFile,
  submitting = false,
  submitError,
  onResetError,
}: PlusTariffUploadDialogProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage.upload');
  const tUpload = useTranslations('campaignUpload');
  const tCommon = useTranslations('common');
  const fileErrorMessage = useWorkbookErrorMessage(WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF);

  const [file, setFile] = React.useState<File | null>(null);

  const handleOpenChange = (next: boolean): void => {
    // Reset the form when the dialog closes so reopening starts clean.
    if (!next) {
      setFile(null);
    }
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
        <UploadUnplacedIssues error={submitError} placedFields={PLACED_FIELDS} />

        <div className="border-border bg-surface-subtle gap-sm p-md flex flex-col rounded-lg border">
          <p className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
            {t('stepsTitle')}
          </p>
          <ol className="gap-sm flex flex-col">
            {STEP_KEYS.map((key, index) => (
              <li key={key} className="gap-sm flex items-start">
                <span className="bg-primary-soft text-primary-soft-foreground text-2xs flex size-5 shrink-0 items-center justify-center rounded-full font-semibold tabular-nums">
                  {index + 1}
                </span>
                <span className="text-sm">{t(key)}</span>
              </li>
            ))}
          </ol>
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
