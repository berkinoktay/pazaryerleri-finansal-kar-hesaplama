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

import { usePlusTariffFilterFields } from '../hooks/use-plus-tariff-filter-fields';
import type { PlusTariffFilterState } from '../lib/plus-bulk-actions';
import { tariffFilterStateFromRows, tariffRowsFromFilterState } from '../lib/tariff-filter-fields';

export interface PlusTariffsToolbarProps {
  searchValue: string;
  onSearchChange: (next: string) => void;
  categories: readonly string[];
  brands: readonly string[];
  filters: PlusTariffFilterState;
  onFiltersChange: (next: Partial<PlusTariffFilterState>) => void;
  onSelectBest: () => void;
  onJoinProfitable: () => void;
  onClearJoins: () => void;
}

/**
 * Plus tariff-detail toolbar: search + the domain-specific smart-join popover +
 * the standard advanced-filter building blocks (add button in the control row,
 * applied chips as their own row beneath). Mounted by BOTH the desktop table's
 * toolbar zone and the mobile cards header, so the building blocks are used
 * directly. The smart-join popover mirrors the commission one, adapted to the single
 * Plus offer: pick each row's most profitable option (join where Plus wins,
 * un-join where the current price wins), join only the profitable ones, or clear.
 */
export function PlusTariffsToolbar({
  searchValue,
  onSearchChange,
  categories,
  brands,
  filters,
  onFiltersChange,
  onSelectBest,
  onJoinProfitable,
  onClearJoins,
}: PlusTariffsToolbarProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage');

  const filterFields = usePlusTariffFilterFields(categories, brands);
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

        {/* Smart join */}
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
            <Button variant="ghost" size="sm" className="justify-start" onClick={onJoinProfitable}>
              {t('smartSelect.joinProfitable')}
            </Button>
            <Separator />
            <Button variant="ghost" size="sm" className="justify-start" onClick={onClearJoins}>
              {t('smartSelect.clear')}
            </Button>
            <p className="text-2xs text-muted-foreground">{t('smartSelect.scopeHint')}</p>
          </PopoverContent>
        </Popover>
      </div>

      {/* Chip-row clear follows the epic-wide convention: CHIPS only — the search
          box keeps its text. The full reset (query included) lives on the table's
          no-results CTA. */}
      <AdvancedFilterChips
        fields={filterFields}
        value={filterRows}
        onApply={handleRowsApply}
        onClearAll={() => handleRowsApply([])}
      />
    </div>
  );
}
