'use client';

import { Download04Icon, File01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

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

import type { ExportPreviewFile } from '../lib/whole-week';

export interface ExportTariffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The window files the download will produce (day count + product count), in order. */
  files: readonly ExportPreviewFile[];
  isExporting: boolean;
  onConfirm: () => void;
}

/**
 * Pre-download preview: before saving + exporting, show the seller EXACTLY which window
 * files (3/4/7 Günlük Fiyat) will download and how many products each holds, then let
 * them confirm. Replaces the old floating action bar so export is a deliberate,
 * well-understood step from a fixed button. A single file downloads directly; more than
 * one arrives as a .zip (noted below the list).
 */
export function ExportTariffDialog({
  open,
  onOpenChange,
  files,
  isExporting,
  onConfirm,
}: ExportTariffDialogProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.exportDialog');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <ul className="gap-2xs flex flex-col">
          {files.map((file) => (
            <li
              key={file.dayCount}
              className="gap-sm border-border bg-card px-md py-sm flex items-center justify-between rounded-lg border"
            >
              <span className="gap-2xs flex min-w-0 items-center">
                <File01Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <span className="truncate text-sm font-medium">
                  {t('fileName', { days: file.dayCount })}
                </span>
              </span>
              <span className="text-2xs text-muted-foreground shrink-0 tabular-nums">
                {t('productCount', { count: file.count })}
              </span>
            </li>
          ))}
        </ul>

        {files.length > 1 ? (
          <p className="text-2xs text-muted-foreground">{t('zipNote', { count: files.length })}</p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t('cancel')}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={isExporting || files.length === 0}
            leadingIcon={<Download04Icon aria-hidden />}
          >
            {isExporting ? t('exporting') : t('download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
