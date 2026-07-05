'use client';

import { Download04Icon } from 'hugeicons-react';
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
  /** Phase 1: the seller's selections are being persisted (PATCH). */
  isSaving: boolean;
  /** Phase 2: the patched xlsx / zip is being generated + downloaded. */
  isDownloading: boolean;
  onConfirm: () => void;
}

/**
 * Pre-download preview: before saving + exporting, show the seller EXACTLY which window
 * files (3/4/7 Günlük Fiyat) will download and how many products each holds, then let
 * them confirm. A single file downloads directly; more than one arrives as a .zip (noted
 * below the list). The confirm button reports its two phases in order — first the
 * selections are saved ("kaydediliyor…"), then the file downloads ("indiriliyor…") — so
 * a seller whose save fails knows their choices were the step that didn't complete.
 */
export function ExportTariffDialog({
  open,
  onOpenChange,
  files,
  isSaving,
  isDownloading,
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
              <span className="gap-sm flex min-w-0 items-center">
                {/* Static file-type tag — makes it plain these download as Excel
                    files (the multi-file case zips, noted below). */}
                <span className="text-2xs bg-muted text-muted-foreground px-2xs py-3xs shrink-0 rounded-sm font-semibold tracking-wide">
                  XLSX
                </span>
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
            disabled={files.length === 0}
            loading={isSaving || isDownloading}
            // Phase-accurate label: saving the selections, then downloading.
            loadingText={isSaving ? t('saving') : t('exporting')}
            leadingIcon={<Download04Icon aria-hidden />}
          >
            {t('download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
