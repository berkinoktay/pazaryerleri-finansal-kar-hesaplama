'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';

import { DateInput } from '@/components/patterns/date-input';
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

const STEP_KEYS = ['step1', 'step2', 'step3'] as const;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export interface CommissionTariffUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires on submit with the chosen file + the period the seller entered. */
  onFile: (file: File, range: DateRange | undefined) => void;
}

/**
 * Excel-upload dialog over the tariff list. A focused mini-form that keeps the
 * list in context (vs a full-screen state): the dropzone, a period date-range
 * (the Trendyol file's labels omit the year, so the seller sets the dates here),
 * and a short "how it works" guide. Submitting creates the tariff and the caller
 * routes on to the detail screen.
 */
export function CommissionTariffUploadDialog({
  open,
  onOpenChange,
  onFile,
}: CommissionTariffUploadDialogProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.upload');
  const tCommon = useTranslations('common');

  const [file, setFile] = React.useState<File | null>(null);
  const [startDate, setStartDate] = React.useState<Date | null>(null);
  const [endDate, setEndDate] = React.useState<Date | null>(null);

  const handleOpenChange = (next: boolean): void => {
    // Reset the form when the dialog closes so reopening starts clean.
    if (!next) {
      setFile(null);
      setStartDate(null);
      setEndDate(null);
    }
    onOpenChange(next);
  };

  const handleSubmit = (): void => {
    if (file === null) return;
    onFile(file, { from: startDate ?? undefined, to: endDate ?? undefined });
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
          maxSize={MAX_SIZE_BYTES}
          prompt={t('prompt')}
          hint={t('hint')}
          ctaLabel={t('cta')}
          onChange={setFile}
        />

        <div className="gap-2xs flex flex-col">
          <span className="text-foreground text-sm font-medium">{t('periodLabel')}</span>
          <div className="gap-sm flex flex-col sm:flex-row">
            <DateInput
              value={startDate}
              onChange={setStartDate}
              placeholder={t('startPlaceholder')}
              className="w-full"
            />
            <DateInput
              value={endDate}
              onChange={setEndDate}
              placeholder={t('endPlaceholder')}
              defaultMonth={startDate ?? undefined}
              className="w-full"
            />
          </div>
          <p className="text-2xs text-muted-foreground">{t('periodHint')}</p>
        </div>

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
          <Button onClick={handleSubmit} disabled={file === null}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
