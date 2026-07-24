'use client';

import { Alert02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { SearchInput } from '@/components/patterns/search-input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Toggle } from '@/components/ui/toggle';

import type { DiscountFilterState } from '../lib/discount-selection';

export interface DiscountItemsToolbarProps {
  filters: DiscountFilterState;
  onFiltersChange: (next: Partial<DiscountFilterState>) => void;
  /** Add every row to the local selection Set. */
  onSelectAll: () => void;
  /** Add only the visible rows that still net a profit to the local selection Set. */
  onSelectProfitable: () => void;
  /** Empty the local selection Set. */
  onClearSelections: () => void;
  /** True while a save flush is in flight — disables the smart-select actions. */
  selectionsPending: boolean;
  /** The client's EPHEMERAL local selection size — drives the over-500 warning strip. */
  selectedCount: number;
}

/** Trendyol only processes the first 500 included products. */
const TRENDYOL_SELECTION_CAP = 500;

/**
 * İndirimler detail toolbar: search + two filter chips (profitable / losing) + the smart-select
 * popover (include all, only-profitable, clear). Mounted by BOTH the desktop table's toolbar zone
 * and the mobile cards header. Below the controls sit the over-500 warning (Trendyol caps at the
 * first 500 included products) and the variant note. The filter chips are pure projections over
 * the backend-computed profit sign — comparison, never money math.
 */
export function DiscountItemsToolbar({
  filters,
  onFiltersChange,
  onSelectAll,
  onSelectProfitable,
  onClearSelections,
  selectionsPending,
  selectedCount,
}: DiscountItemsToolbarProps): React.ReactElement {
  const t = useTranslations('discountsPage');
  const tFilters = useTranslations('discountsPage.filters');
  const tSmart = useTranslations('discountsPage.smartSelect');
  const tTable = useTranslations('discountsPage.table');

  return (
    <div className="gap-xs flex flex-col">
      <div className="gap-sm flex flex-wrap items-center">
        <SearchInput
          value={filters.query}
          onChange={(event) => onFiltersChange({ query: event.target.value })}
          placeholder={t('search')}
          className="max-w-input"
        />

        <div className="gap-2xs flex flex-wrap items-center">
          <Toggle
            variant="outline"
            size="sm"
            pressed={filters.profitable}
            onPressedChange={(pressed) => onFiltersChange({ profitable: pressed })}
          >
            {tFilters('profitable')}
          </Toggle>
          <Toggle
            variant="outline"
            size="sm"
            pressed={filters.losing}
            onPressedChange={(pressed) => onFiltersChange({ losing: pressed })}
          >
            {tFilters('losing')}
          </Toggle>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" loading={selectionsPending}>
              {tSmart('label')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="gap-sm flex w-72 flex-col">
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={selectionsPending}
              onClick={onSelectAll}
            >
              {tSmart('selectAll')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={selectionsPending}
              onClick={onSelectProfitable}
            >
              {tSmart('selectProfitable')}
            </Button>
            <Separator />
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={selectionsPending}
              onClick={onClearSelections}
            >
              {tSmart('clear')}
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      {selectedCount > TRENDYOL_SELECTION_CAP ? (
        <div className="bg-warning-surface gap-sm p-sm flex items-start rounded-lg">
          <Alert02Icon className="text-warning size-icon-sm mt-3xs shrink-0" aria-hidden />
          <p className="text-warning text-2xs">{tTable('over500Warning')}</p>
        </div>
      ) : null}

      <p className="text-muted-foreground text-2xs">{tTable('variantNote')}</p>
    </div>
  );
}
