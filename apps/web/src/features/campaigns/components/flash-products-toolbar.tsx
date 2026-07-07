'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  AdvancedFilterAddButton,
  AdvancedFilterChips,
} from '@/components/patterns/advanced-filter-menu';
import { SearchInput } from '@/components/patterns/search-input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';

import { useFlashProductFilterFields } from '../hooks/use-flash-product-filter-fields';
import type { FlashProductFilterState } from '../lib/flash-bulk-actions';
import { tariffFilterStateFromRows, tariffRowsFromFilterState } from '../lib/tariff-filter-fields';

export interface FlashProductsToolbarProps {
  searchValue: string;
  onSearchChange: (next: string) => void;
  categories: readonly string[];
  brands: readonly string[];
  filters: FlashProductFilterState;
  onFiltersChange: (next: Partial<FlashProductFilterState>) => void;
  onSelectBest: () => void;
  onSelectProfitable: () => void;
  onClearSelections: () => void;
}

/**
 * Flash Products detail toolbar: search + the domain-specific smart-select popover + the
 * standard advanced-filter building blocks (add button in the control row, applied chips as
 * their own row beneath). Mounted by BOTH the desktop table's toolbar zone and the mobile
 * cards header. The smart-select popover picks the most-profitable offer for every row,
 * only the ones that beat the current price, or clears — because a Flash row is a 1-of-4
 * choice, not a single boolean.
 */
export function FlashProductsToolbar({
  searchValue,
  onSearchChange,
  categories,
  brands,
  filters,
  onFiltersChange,
  onSelectBest,
  onSelectProfitable,
  onClearSelections,
}: FlashProductsToolbarProps): React.ReactElement {
  const t = useTranslations('flashProductsPage');

  const filterFields = useFlashProductFilterFields(categories, brands);
  const filterRows = tariffRowsFromFilterState(filters);
  const handleRowsApply = (rows: Parameters<typeof tariffFilterStateFromRows>[0]): void => {
    onFiltersChange(tariffFilterStateFromRows(rows));
  };

  return (
    <div className="gap-xs flex flex-col">
      <div className="gap-sm flex flex-wrap items-center">
        <SearchInput
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('search')}
          className="max-w-input"
        />

        <AdvancedFilterAddButton
          fields={filterFields}
          value={filterRows}
          onApply={handleRowsApply}
        />

        {/* Smart select */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              {t('smartSelect.label')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="gap-sm flex w-72 flex-col">
            <Button variant="ghost" size="sm" className="justify-start" onClick={onSelectBest}>
              {t('smartSelect.selectBest')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={onSelectProfitable}
            >
              {t('smartSelect.selectProfitable')}
            </Button>
            <Separator />
            <Button variant="ghost" size="sm" className="justify-start" onClick={onClearSelections}>
              {t('smartSelect.clear')}
            </Button>
            <p className="text-2xs text-muted-foreground">{t('smartSelect.scopeHint')}</p>
          </PopoverContent>
        </Popover>
      </div>

      {/* Chip-row clear follows the epic-wide convention: CHIPS only — the search box keeps
          its text. The full reset (query included) lives on the table's no-results CTA. */}
      <AdvancedFilterChips
        fields={filterFields}
        value={filterRows}
        onApply={handleRowsApply}
        onClearAll={() => handleRowsApply([])}
      />
    </div>
  );
}
