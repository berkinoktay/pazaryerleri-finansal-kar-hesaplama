'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useUploadFieldErrorMessage } from '../hooks/use-upload-field-error-message';
import { WORKBOOK_VERTICALS } from '../lib/workbook-verticals';

/** The commission tariff list page, where the seller uploads a tariff. */
const COMMISSION_TARIFFS_PATH = WORKBOOK_VERTICALS[WORKBOOK_PAGES.COMMISSION_TARIFF].detailBase;

/**
 * Sentinel value of the category commission choice. Radix Select forbids an empty-string value,
 * so the category choice is carried as this token; it is sent as no pinned tariff at all.
 */
export const CATEGORY_COMMISSION_SOURCE = '__category__';

/**
 * Default commission-source choice for a fresh upload: the nearest-UPCOMING tariff
 * (soonest `weekStartsAt`), else the most-recent current/past tariff (largest
 * `weekStartsAt`), else the newest listed tariff (the list is newest-first). When
 * there are NO tariffs at all it returns `undefined`: nothing is pre-selected, so
 * the seller makes a conscious choice between uploading a tariff and the category
 * commission fallback. Uses the server-computed `validity` (relative to the business
 * day) rather than the client clock, so it is a pure, deterministic function, with no
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

/**
 * The commission source in effect: the seller's explicit choice (a tariff id or
 * {@link CATEGORY_COMMISSION_SOURCE}), else the default derived from the store's commission
 * tariff list once it has loaded. Nothing is seeded into state, so there is neither a
 * render-phase set (which loops for an empty list) nor a setState-in-effect; the default
 * re-derives against the latest list whenever the explicit choice is cleared.
 */
export function resolveCommissionSource(
  choice: string | undefined,
  tariffs: readonly CommissionTariffListItem[] | undefined,
  loading: boolean,
): string | undefined {
  if (choice !== undefined) return choice;
  if (loading) return undefined;
  return pickDefaultCommissionSource(tariffs ?? []);
}

export interface CommissionSourcePickerProps {
  /** Org scope of the store's commission tariff list. */
  orgId: string;
  /** Store scope of the store's commission tariff list. */
  storeId: string;
  /** The commission source in effect ({@link resolveCommissionSource}), undefined until one exists. */
  value: string | undefined;
  /** Records the seller's explicit choice: a tariff id or {@link CATEGORY_COMMISSION_SOURCE}. */
  onChange: (next: string) => void;
  /** The code of the import's `commissionSourceTariffId` issue, shown under the picker. */
  serverError: string | null;
}

/**
 * The REQUIRED commission-source choice of the Advantage upload. The Advantage file carries no
 * commission of its own, so the seller pins which commission tariff (week) supplies the reduced
 * rates, or explicitly opts into the category commission. Two mutually exclusive cards: the
 * tariff picker (the accurate path) and the category fallback.
 */
export function CommissionSourcePicker({
  orgId,
  storeId,
  value,
  onChange,
  serverError,
}: CommissionSourcePickerProps): React.ReactElement {
  const tSource = useTranslations('productLabelsPage.upload.commissionSource');
  const tCommon = useTranslations('common');
  const fieldErrorMessage = useUploadFieldErrorMessage();
  const commissionList = useCommissionTariffList(orgId, storeId);
  const commissionTariffLabel = useCommissionTariffLabel();
  const titleId = React.useId();

  const listLoading = commissionList.isLoading;
  const tariffs = commissionList.data ?? [];
  const showEmptySource = !listLoading && tariffs.length === 0;
  // A tariff id is pinned (path 1) vs. the category sentinel (path 2) vs. nothing
  // chosen yet: drives the two cards' active highlight and the Select's value.
  const isTariffActive = value !== undefined && value !== CATEGORY_COMMISSION_SOURCE;
  const isCategoryActive = value === CATEGORY_COMMISSION_SOURCE;

  return (
    <div role="group" aria-labelledby={titleId} className="gap-sm flex flex-col">
      <div className="gap-3xs flex flex-col">
        <p id={titleId} className="text-sm font-medium">
          {tSource('title')}
        </p>
        <p className="text-2xs text-muted-foreground">{tSource('intro')}</p>
      </div>

      {/* Path 1: pin a Product Commission Tariff (the accurate path). */}
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
            {/* Inside a form, Radix mirrors the Select into a hidden native select for
                autofill and reports its value back: '' when the value moves to none or to an
                option not mounted yet. A tariff id is never empty, so '' is not a choice. The
                value stays controlled ('' shows the placeholder), as in the config forms. */}
            <Select
              value={isTariffActive ? value : ''}
              onValueChange={(next) => {
                if (next !== '') onChange(next);
              }}
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
            <Button asChild variant="link" size="sm" className="h-auto self-start px-0 py-0">
              <Link href={COMMISSION_TARIFFS_PATH}>{tSource('uploadNew')}</Link>
            </Button>
          </div>
        )}
      </div>

      {/* "or": the two paths are mutually exclusive. */}
      <div className="gap-sm flex items-center">
        <div className="bg-border h-px flex-1" />
        <span className="text-2xs text-muted-foreground tracking-wide uppercase">
          {tSource('or')}
        </span>
        <div className="bg-border h-px flex-1" />
      </div>

      {/* Path 2: fall back to the product's category commission. */}
      <button
        type="button"
        onClick={() => onChange(CATEGORY_COMMISSION_SOURCE)}
        className={cn(
          'p-md gap-sm flex cursor-pointer items-start rounded-lg border text-left',
          'duration-fast ease-out-quart transition-colors',
          isCategoryActive ? 'border-primary' : 'border-border bg-card hover:bg-surface-subtle',
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

      {value === undefined ? (
        <p className="text-2xs text-muted-foreground">{tSource('required')}</p>
      ) : null}
      {serverError !== null ? (
        <p role="alert" className="text-2xs text-destructive font-medium">
          {fieldErrorMessage(serverError)}
        </p>
      ) : null}
    </div>
  );
}
