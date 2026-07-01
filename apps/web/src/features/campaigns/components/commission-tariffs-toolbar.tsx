'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { SearchInput } from '@/components/patterns/search-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type {
  ProfitFilter,
  SelectionFilter,
  TargetStrategy,
  TariffFilterState,
} from '../lib/bulk-actions';

export interface CommissionTariffsToolbarProps {
  searchValue: string;
  onSearchChange: (next: string) => void;
  categories: readonly string[];
  brands: readonly string[];
  filters: TariffFilterState;
  onFiltersChange: (next: Partial<TariffFilterState>) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
  onBestAll: () => void;
  onProfitableOnly: () => void;
  onTargetMargin: (targetPct: number, strategy: TargetStrategy) => void;
  onClearSelections: () => void;
}

const ALL = '__all__';

export function CommissionTariffsToolbar({
  searchValue,
  onSearchChange,
  categories,
  brands,
  filters,
  onFiltersChange,
  onClearFilters,
  hasActiveFilters,
  onBestAll,
  onProfitableOnly,
  onTargetMargin,
  onClearSelections,
}: CommissionTariffsToolbarProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const [target, setTarget] = React.useState('10');
  const [strategy, setStrategy] = React.useState<TargetStrategy>('least-drop');

  return (
    <div className="gap-sm flex flex-wrap items-center">
      <SearchInput
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={t('search')}
        className="max-w-input"
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

      {/* Filters */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            {t('filters.label')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="gap-md flex w-72 flex-col">
          <div className="gap-3xs flex flex-col">
            <Label className="text-2xs text-muted-foreground">{t('filters.category')}</Label>
            <Select
              value={filters.category ?? ALL}
              onValueChange={(value) => onFiltersChange({ category: value === ALL ? null : value })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('filters.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="gap-3xs flex flex-col">
            <Label className="text-2xs text-muted-foreground">{t('filters.brand')}</Label>
            <Select
              value={filters.brand ?? ALL}
              onValueChange={(value) => onFiltersChange({ brand: value === ALL ? null : value })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('filters.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
                {brands.map((brand) => (
                  <SelectItem key={brand} value={brand}>
                    {brand}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="gap-3xs flex flex-col">
            <Label htmlFor="min-margin" className="text-2xs text-muted-foreground">
              {t('filters.minMargin')}
            </Label>
            <Input
              id="min-margin"
              inputMode="decimal"
              value={filters.minMarginPct === null ? '' : String(filters.minMarginPct)}
              onChange={(event) =>
                onFiltersChange({
                  minMarginPct: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            />
          </div>

          <div className="gap-3xs flex flex-col">
            <Label className="text-2xs text-muted-foreground">{t('filters.profit')}</Label>
            <RadioGroup
              value={filters.profit}
              onValueChange={(value: ProfitFilter) => onFiltersChange({ profit: value })}
              className="gap-xs flex flex-wrap"
            >
              {(['all', 'profitable', 'loss'] as const).map((value) => (
                <Label key={value} className="gap-3xs flex items-center text-xs font-normal">
                  <RadioGroupItem value={value} />
                  {t(
                    value === 'all'
                      ? 'filters.profitAll'
                      : value === 'profitable'
                        ? 'filters.profitProfitable'
                        : 'filters.profitLoss',
                  )}
                </Label>
              ))}
            </RadioGroup>
          </div>

          <div className="gap-3xs flex flex-col">
            <Label className="text-2xs text-muted-foreground">{t('filters.selection')}</Label>
            <RadioGroup
              value={filters.selection}
              onValueChange={(value: SelectionFilter) => onFiltersChange({ selection: value })}
              className="gap-xs flex flex-wrap"
            >
              {(['all', 'selected', 'unselected'] as const).map((value) => (
                <Label key={value} className="gap-3xs flex items-center text-xs font-normal">
                  <RadioGroupItem value={value} />
                  {t(
                    value === 'all'
                      ? 'filters.selectionAll'
                      : value === 'selected'
                        ? 'filters.selectionSelected'
                        : 'filters.selectionUnselected',
                  )}
                </Label>
              ))}
            </RadioGroup>
          </div>

          {hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={onClearFilters}>
              {t('filters.clear')}
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
