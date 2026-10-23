'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { SearchInput } from '@/components/patterns/search-input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Toggle } from '@/components/ui/toggle';

import type { CampaignFilterState } from '../lib/marketplace-campaign-selection';

type ChipKey = 'profitable' | 'losing' | 'selected' | 'tariffWarning';

export interface MarketplaceCampaignToolbarProps {
  filters: CampaignFilterState;
  onFiltersChange: (next: Partial<CampaignFilterState>) => void;
  /** Whether any row carries the commission-tariff warning — its chip would match nothing otherwise. */
  showTariffWarningFilter: boolean;
  onSelectAllMax: () => void;
  onSelectProfitable: () => void;
  /** Opens the target-margin dialog. */
  onOpenTargetMargin: () => void;
  onClearSelections: () => void;
  /** True while a save is in flight — disables the smart-select actions. */
  pending: boolean;
}

/**
 * Kampanyalar detail toolbar: search + the filter chips (profitable / losing / selected / tariff
 * warning) + the smart-select menu (all at the maximum, only the profitable, fill custom prices for
 * a target margin, clear). Mounted by BOTH the desktop table's toolbar zone and the mobile cards
 * header. Every action works on the VISIBLE rows; the chips are sign checks over backend figures,
 * never money math.
 */
export function MarketplaceCampaignToolbar({
  filters,
  onFiltersChange,
  showTariffWarningFilter,
  onSelectAllMax,
  onSelectProfitable,
  onOpenTargetMargin,
  onClearSelections,
  pending,
}: MarketplaceCampaignToolbarProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage');
  const tFilters = useTranslations('marketplaceCampaignsPage.filters');
  const tSmart = useTranslations('marketplaceCampaignsPage.smartSelect');
  // Controlled so an action closes the menu — the target-margin dialog must not open over it.
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Concrete keys per chip — next-intl's typed `t` takes a literal, not the chip union.
  const chipLabel: Record<ChipKey, string> = {
    profitable: tFilters('profitable'),
    losing: tFilters('losing'),
    selected: tFilters('selected'),
    tariffWarning: tFilters('tariffWarning'),
  };
  const chips: readonly ChipKey[] = showTariffWarningFilter
    ? ['profitable', 'losing', 'selected', 'tariffWarning']
    : ['profitable', 'losing', 'selected'];

  const run = (action: () => void) => (): void => {
    setMenuOpen(false);
    action();
  };

  return (
    <div className="gap-sm flex flex-wrap items-center">
      <SearchInput
        value={filters.query}
        onChange={(event) => onFiltersChange({ query: event.target.value })}
        placeholder={t('search')}
        className="max-w-input"
      />

      <div className="gap-2xs flex flex-wrap items-center">
        {chips.map((chip) => (
          <Toggle
            key={chip}
            variant="outline"
            size="sm"
            pressed={filters[chip]}
            onPressedChange={(pressed) => onFiltersChange({ [chip]: pressed })}
          >
            {chipLabel[chip]}
          </Toggle>
        ))}
      </div>

      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" loading={pending}>
            {tSmart('label')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="gap-sm flex w-72 flex-col">
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            disabled={pending}
            onClick={run(onSelectAllMax)}
          >
            {tSmart('selectAllMax')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            disabled={pending}
            onClick={run(onSelectProfitable)}
          >
            {tSmart('selectProfitable')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            disabled={pending}
            onClick={run(onOpenTargetMargin)}
          >
            {tSmart('targetMargin')}
          </Button>
          <Separator />
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            disabled={pending}
            onClick={run(onClearSelections)}
          >
            {tSmart('clear')}
          </Button>
          <p className="text-2xs text-muted-foreground">{tSmart('scopeHint')}</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
