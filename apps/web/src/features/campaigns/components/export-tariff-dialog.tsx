'use client';

import { Download04Icon } from 'hugeicons-react';
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

/**
 * All localized copy the dialog renders, passed in by the caller (the {@link
 * TariffProfitBlock} labels-as-props pattern) so the ONE dialog serves both the
 * commission vertical (`commissionTariffsPage.exportDialog`) and the Plus vertical
 * (`plusCommissionTariffsPage.exportDialog`) without a hard-coded namespace.
 */
export interface ExportTariffDialogLabels {
  title: string;
  description: string;
  /** File-name row, e.g. "3 Günlük Fiyat". */
  fileName: (days: number) => string;
  /** Product-count row, e.g. "2 ürün". */
  productCount: (count: number) => string;
  /** Multi-file ZIP note, e.g. "3 dosya tek ZIP olarak inecek." */
  zipNote: (count: number) => string;
  cancel: string;
  download: string;
  /** Confirm-button label during the selections-PATCH phase. */
  saving: string;
  /** Confirm-button label during the file-download phase. */
  exporting: string;
}

export interface ExportTariffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The window files the download will produce (day count + product count), in order. */
  files: readonly ExportPreviewFile[];
  labels: ExportTariffDialogLabels;
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
  labels,
  isSaving,
  isDownloading,
  onConfirm,
}: ExportTariffDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
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
                  {labels.fileName(file.dayCount)}
                </span>
              </span>
              <span className="text-2xs text-muted-foreground shrink-0 tabular-nums">
                {labels.productCount(file.count)}
              </span>
            </li>
          ))}
        </ul>

        {files.length > 1 ? (
          <p className="text-2xs text-muted-foreground">{labels.zipNote(files.length)}</p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {labels.cancel}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={files.length === 0}
            loading={isSaving || isDownloading}
            // Phase-accurate label: saving the selections, then downloading.
            loadingText={isSaving ? labels.saving : labels.exporting}
            leadingIcon={<Download04Icon aria-hidden />}
          >
            {labels.download}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
