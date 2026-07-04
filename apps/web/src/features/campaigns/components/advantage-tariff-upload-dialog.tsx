'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { FileUpload } from '@/components/patterns/file-upload';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import type { CommissionTariffListItem } from '../api/list-tariffs.api';
import { useCommissionTariffLabel } from '../hooks/use-commission-tariff-label';
import { useCommissionTariffList } from '../hooks/use-commission-tariff-list';

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const COMMISSION_TARIFFS_PATH = '/campaigns/product-commission-tariffs';

/**
 * Sentinel Select value for the "Kategori komisyonu" choice — Radix Select
 * forbids an empty-string value, so category is carried as this token and mapped
 * back to `undefined` (no pin) on submit.
 */
const CATEGORY_VALUE = '__category__';

/**
 * Default commission-source choice for a fresh upload: the nearest-UPCOMING tariff
 * (soonest `weekStartsAt`), else the most-recent current/past tariff (largest
 * `weekStartsAt`), else the newest listed tariff (the list is newest-first). When
 * there are NO tariffs at all it returns `undefined` — nothing is pre-selected, so
 * the seller makes a conscious choice between uploading a tariff and the category
 * commission fallback. Uses the server-computed `validity` (relative to the business
 * day) rather than the client clock, so it is a pure, deterministic function — no
 * `Date.now()` in the render path.
 */
function pickDefaultCommissionSource(
  items: readonly CommissionTariffListItem[],
): string | undefined {
  if (items.length === 0) return undefined;
  const startMs = (item: CommissionTariffListItem): number =>
    item.weekStartsAt !== null ? new Date(item.weekStartsAt).getTime() : 0;
  const upcoming = items
    .filter((item) => item.validity === 'upcoming' && item.weekStartsAt !== null)
    .sort((a, b) => startMs(a) - startMs(b));
  if (upcoming.length > 0) return upcoming[0].id;
  const currentOrPast = items
    .filter(
      (item) =>
        (item.validity === 'active' || item.validity === 'past') && item.weekStartsAt !== null,
    )
    .sort((a, b) => startMs(b) - startMs(a));
  if (currentOrPast.length > 0) return currentOrPast[0].id;
  return items[0].id;
}

export interface AdvantageTariffUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Org scope for the commission-source picker's tariff list (guaranteed non-null by the list client). */
  orgId: string;
  /** Store scope for the commission-source picker's tariff list. */
  storeId: string;
  /** Fires on submit with the chosen file and the pinned commission tariff (or `undefined` for category commission). */
  onFile: (file: File, commissionSourceTariffId: string | undefined) => void;
  /** True while the import request is in flight (drives the submit button). */
  submitting?: boolean;
  /** Backend file-rejection code (from `extractFileErrorCode`), shown inline. */
  errorCode?: string | null;
  /** Clears the last import error when the seller picks a different file. */
  onResetError?: () => void;
}

/** Maps a backend file-rejection code to its localized message key bucket. */
function useFileErrorMessage(): (code: string | null | undefined) => string | null {
  const t = useTranslations('productLabelsPage.upload.errors');
  return (code) => {
    switch (code) {
      case null:
      case undefined:
        return null;
      case 'NOT_XLSX':
      case 'CORRUPT_FILE':
        return t('notReadable');
      case 'EMPTY_TARIFF_FILE':
        return t('empty');
      case 'ROW_CAP_EXCEEDED':
      case 'COL_CAP_EXCEEDED':
      case 'PAYLOAD_TOO_LARGE':
        return t('tooLarge');
      case 'SHEET_NOT_FOUND':
      case 'INVALID_ADVANTAGE_TARIFF_FORMAT':
      case 'INVALID_TARIFF_FORMAT':
      case 'MISSING_REQUIRED_HEADERS':
      case 'AMBIGUOUS_HEADERS':
        return t('wrongFormat');
      default:
        return t('generic');
    }
  };
}

/**
 * Excel-upload dialog over the Advantage tariff list. A focused mini-form that keeps the
 * list in context (vs a full-screen state): the dropzone, a short "how it works" guide,
 * and a REQUIRED commission-source picker. The Advantage file carries no commission of
 * its own, so the seller must pin which commission tariff (week) supplies the reduced
 * rates — or explicitly opt into the category commission. Submitting creates the tariff
 * and the caller routes on to the detail screen.
 */
export function AdvantageTariffUploadDialog({
  open,
  onOpenChange,
  orgId,
  storeId,
  onFile,
  submitting = false,
  errorCode,
  onResetError,
}: AdvantageTariffUploadDialogProps): React.ReactElement {
  const t = useTranslations('productLabelsPage.upload');
  const tSource = useTranslations('productLabelsPage.upload.commissionSource');
  const tCommon = useTranslations('common');
  const fileErrorMessage = useFileErrorMessage();
  const commissionList = useCommissionTariffList(orgId, storeId);
  const commissionTariffLabel = useCommissionTariffLabel();

  const listLoading = commissionList.isLoading;
  const tariffs = React.useMemo(() => commissionList.data ?? [], [commissionList.data]);

  const [file, setFile] = React.useState<File | null>(null);
  // The seller's EXPLICIT choice (a week id, the category sentinel, or undefined until
  // they pick). The visible selection falls back to `defaultValue` below — nothing is
  // seeded into state, so there is neither a render-phase set (which loops for an empty
  // list) nor a setState-in-effect (lint-forbidden). Reset to undefined when the dialog
  // closes so it re-derives against the latest list on reopen.
  const [sourceValue, setSourceValue] = React.useState<string | undefined>(undefined);
  // Default while unchosen: the nearest-upcoming week, or undefined for a store with no
  // tariffs (then the seller must consciously pick a tariff or the category fallback).
  const defaultValue = React.useMemo(
    () => (listLoading ? undefined : pickDefaultCommissionSource(tariffs)),
    [listLoading, tariffs],
  );
  const effectiveValue = sourceValue ?? defaultValue;

  const handleOpenChange = (next: boolean): void => {
    // Reset the form when the dialog closes so reopening starts clean and re-seeds the
    // default against the latest commission-tariff list.
    if (!next) {
      setFile(null);
      setSourceValue(undefined);
    }
    onOpenChange(next);
  };

  const handleSubmit = (): void => {
    if (file === null || effectiveValue === undefined) return;
    onFile(file, effectiveValue === CATEGORY_VALUE ? undefined : effectiveValue);
  };

  const showEmptySource = !listLoading && tariffs.length === 0;
  // A tariff id is pinned (PATH 1) vs. the category sentinel (PATH 2) vs. nothing
  // chosen yet — drives the two cards' active highlight and the Select's value.
  const isTariffActive = effectiveValue !== undefined && effectiveValue !== CATEGORY_VALUE;
  const isCategoryActive = effectiveValue === CATEGORY_VALUE;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="advantage-upload-modal flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="gap-lg grid md:grid-cols-2">
            {/* LEFT: upload the Excel + how it works. */}
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

            {/* RIGHT: which commission tariff (week) supplies the tier rates. */}
            <div className="gap-sm flex flex-col">
              <div className="gap-3xs flex flex-col">
                <p className="text-sm font-medium">{tSource('title')}</p>
                <p className="text-2xs text-muted-foreground">{tSource('intro')}</p>
              </div>

              {/* PATH 1 — pin a Product Commission Tariff (the accurate path). */}
              <div
                className={cn(
                  'p-md gap-sm flex flex-col rounded-lg border',
                  isTariffActive ? 'border-primary' : 'border-border bg-card',
                )}
              >
                <div className="gap-sm flex items-center justify-between">
                  <span className="text-sm font-medium">{tSource('tariffOption')}</span>
                  <Badge tone="info" variant="surface" size="sm">
                    {tSource('recommended')}
                  </Badge>
                </div>
                <p className="text-2xs text-muted-foreground">{tSource('tariffHint')}</p>

                {showEmptySource ? (
                  <div className="gap-sm flex flex-col">
                    <p className="text-muted-foreground text-2xs">{tSource('empty')}</p>
                    <Button asChild variant="outline" size="sm" className="self-start">
                      <Link href={COMMISSION_TARIFFS_PATH}>{tSource('uploadCta')}</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="gap-2xs flex flex-col">
                    <Select
                      value={isTariffActive ? effectiveValue : undefined}
                      onValueChange={setSourceValue}
                    >
                      <SelectTrigger
                        aria-label={tSource('tariffOption')}
                        loading={listLoading}
                        loadingLabel={tCommon('loading')}
                      >
                        <SelectValue placeholder={tSource('placeholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {tariffs.map((tariff) => (
                          <SelectItem key={tariff.id} value={tariff.id}>
                            {commissionTariffLabel(tariff)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      asChild
                      variant="link"
                      size="sm"
                      className="h-auto self-start px-0 py-0"
                    >
                      <Link href={COMMISSION_TARIFFS_PATH}>{tSource('uploadNew')}</Link>
                    </Button>
                  </div>
                )}
              </div>

              {/* "ya da" — the two paths are mutually exclusive. */}
              <div className="gap-sm flex items-center">
                <div className="bg-border h-px flex-1" />
                <span className="text-2xs text-muted-foreground tracking-wide uppercase">
                  {tSource('or')}
                </span>
                <div className="bg-border h-px flex-1" />
              </div>

              {/* PATH 2 — fall back to the product's category commission. */}
              <button
                type="button"
                onClick={() => setSourceValue(CATEGORY_VALUE)}
                className={cn(
                  'p-md gap-sm flex cursor-pointer items-start rounded-lg border text-left',
                  'duration-fast ease-out-quart transition-colors',
                  isCategoryActive
                    ? 'border-primary'
                    : 'border-border bg-card hover:bg-surface-subtle',
                )}
              >
                <span
                  className={cn(
                    'mt-3xs flex size-4 shrink-0 items-center justify-center rounded-full border',
                    isCategoryActive ? 'border-primary' : 'border-border-strong',
                  )}
                >
                  {isCategoryActive ? <span className="bg-primary size-2 rounded-full" /> : null}
                </span>
                <span className="gap-3xs flex flex-col">
                  <span className="text-sm font-medium">{tSource('categoryOption')}</span>
                  <span className="text-2xs text-muted-foreground">{tSource('categoryHint')}</span>
                </span>
              </button>

              {effectiveValue === undefined ? (
                <p className="text-2xs text-muted-foreground">{tSource('required')}</p>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <DialogClose asChild>
            <Button variant="ghost">{tCommon('cancel')}</Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={file === null || effectiveValue === undefined}
            loading={submitting}
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
