'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  AdvancedFilterAddButton,
  AdvancedFilterChips,
} from '@/components/patterns/advanced-filter-menu';
import { SearchInput } from '@/components/patterns/search-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useTariffFilterFields } from '../hooks/use-tariff-filter-fields';
import type { TargetStrategy, TariffFilterState } from '../lib/bulk-actions';
import { tariffFilterStateFromRows, tariffRowsFromFilterState } from '../lib/tariff-filter-fields';

export interface CommissionTariffsToolbarProps {
  searchValue: string;
  onSearchChange: (next: string) => void;
  categories: readonly string[];
  brands: readonly string[];
  filters: TariffFilterState;
  onFiltersChange: (next: Partial<TariffFilterState>) => void;
  onBestAll: () => void;
  onProfitableOnly: () => void;
  onTargetMargin: (targetPct: number, strategy: TargetStrategy) => void;
  onClearSelections: () => void;
}

/**
 * Tariff-detail toolbar: search + the domain-specific smart-select popover +
 * the standard advanced-filter building blocks (add button in the control
 * row, applied chips as their own row beneath). The old bespoke filter
 * popover (two Selects + margin Input + two RadioGroups) is gone — the five
 * dimensions live in the tariff filter catalog and commit through the shared
 * chip editors. Mounted by BOTH the desktop table's toolbar zone and the
 * mobile cards header, so the building blocks are used directly instead of
 * the full DataTableToolbar (which would force a column-visibility menu the
 * card view can't honor).
 */
export function CommissionTariffsToolbar({
  searchValue,
  onSearchChange,
  categories,
  brands,
  filters,
  onFiltersChange,
  onBestAll,
  onProfitableOnly,
  onTargetMargin,
  onClearSelections,
}: CommissionTariffsToolbarProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const [target, setTarget] = React.useState('10');
  const [strategy, setStrategy] = React.useState<TargetStrategy>('least-drop');

  const filterFields = useTariffFilterFields(categories, brands);
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
            <Button variant="ghost" size="sm" className="justify-start" onClick={onBestAll}>
              {t('smartSelect.bestAll')}
            </Button>
            <Button variant="ghost" size="sm" className="justify-start" onClick={onProfitableOnly}>
              {t('smartSelect.profitableOnly')}
            </Button>
            <Separator />
            <div className="gap-xs flex flex-col">
              <Label className="text-xs font-medium">{t('smartSelect.byTargetTitle')}</Label>
              <div className="gap-xs flex items-end">
                <div className="gap-3xs flex flex-1 flex-col">
                  <Label htmlFor="target-margin" className="text-2xs text-muted-foreground">
                    {t('smartSelect.targetLabel')}
                  </Label>
                  <Input
                    id="target-margin"
                    inputMode="decimal"
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                  />
                </div>
                <Select
                  value={strategy}
                  onValueChange={(value: TargetStrategy) => setStrategy(value)}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="least-drop">{t('smartSelect.strategyLeastDrop')}</SelectItem>
                    <SelectItem value="max-profit">{t('smartSelect.strategyMaxProfit')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={() => onTargetMargin(Number(target) || 0, strategy)}>
                {t('smartSelect.apply')}
              </Button>
            </div>
            <Separator />
            <Button variant="ghost" size="sm" className="justify-start" onClick={onClearSelections}>
              {t('smartSelect.clear')}
            </Button>
            <p className="text-2xs text-muted-foreground">{t('smartSelect.scopeHint')}</p>
          </PopoverContent>
        </Popover>
      </div>

      {/* Chip-row clear follows the epic-wide convention: CHIPS only — the
          search box keeps its text (same as the pricing/products toolbars).
          The full reset (query included) lives on the table's no-results CTA. */}
      <AdvancedFilterChips
        fields={filterFields}
        value={filterRows}
        onApply={handleRowsApply}
        onClearAll={() => handleRowsApply([])}
      />
    </div>
  );
}
