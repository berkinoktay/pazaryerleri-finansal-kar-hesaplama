'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { TableNoResultsState } from '@/components/patterns/data-table-states';
import { ProductImageCell } from '@/components/patterns/product-image-cell';

import type {
  CampaignScenarioPresentation,
  MarketplaceCampaignRow,
} from '../lib/adapt-marketplace-campaign';
import {
  hasCommissionTariffWarning,
  type CampaignCustomPriceMap,
  type CampaignPriceChoice,
  type CampaignSelectionMap,
  type CampaignTargetMarginMark,
} from '../lib/marketplace-campaign-selection';
import { MarketplaceCampaignCurrentCell } from './marketplace-campaign-current-cell';
import { MarketplaceCampaignCustomPriceCell } from './marketplace-campaign-custom-price-cell';
import { MarketplaceCampaignMaxPriceCell } from './marketplace-campaign-max-price-cell';
import { MarketplaceCampaignTariffWarning } from './marketplace-campaign-tariff-warning';

export interface MarketplaceCampaignItemsMobileCardsProps {
  rows: readonly MarketplaceCampaignRow[];
  presentation: CampaignScenarioPresentation;
  selection: CampaignSelectionMap;
  customPrices: CampaignCustomPriceMap;
  /** Why the last target-margin run could not price a row, per row. */
  targetMarginMarks: Readonly<Record<string, CampaignTargetMarginMark>>;
  /** Toggles one price option for a row (the row travels so the buffer can check its ceiling). */
  onToggleChoice: (row: MarketplaceCampaignRow, choice: CampaignPriceChoice) => void;
  onCustomPriceChange: (row: MarketplaceCampaignRow, price: string | null) => void;
  /** Resets the search + chips — the no-results state's "clear filters" action. */
  onClearFilters: () => void;
}

/**
 * Mobile layout: one card per product as a single TOP-TO-BOTTOM flow, so nothing competes
 * horizontally. Zones, each opened by a top divider rule:
 *   1. Product identity — image + title + meta + barcode.
 *   2. Current baseline — the shared current cell.
 *   3. Maximum price — the click-the-card option.
 *   4. Custom price — a what-if AND a selectable option.
 * Full parity with the desktop table: the same cells, so the same "En kârlı" race. Shown below
 * the `md` breakpoint; the desktop table is hidden there.
 */
export function MarketplaceCampaignItemsMobileCards({
  rows,
  presentation,
  selection,
  customPrices,
  targetMarginMarks,
  onToggleChoice,
  onCustomPriceChange,
  onClearFilters,
}: MarketplaceCampaignItemsMobileCardsProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.table');

  // A campaign always has products, so an empty list here means the filters hide them all.
  if (rows.length === 0) return <TableNoResultsState onClearFilters={onClearFilters} />;

  return (
    <div className="gap-sm flex flex-col">
      {rows.map((row) => {
        const meta = [row.brand, row.color, row.size, row.productCode]
          .filter((value): value is string => value !== null && value !== '')
          .join(' · ');
        const price = customPrices[row.id] ?? null;
        return (
          <div
            key={row.id}
            className="border-border bg-card gap-md p-md flex flex-col rounded-lg border"
          >
            {/* Zone 1: product identity — full width, no competing right column. */}
            <div className="gap-sm flex min-w-0 items-start">
              <ProductImageCell url={row.imageUrl} alt={row.productTitle} size="xl" fit="contain" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium">{row.productTitle}</div>
                {meta !== '' ? (
                  <div className="text-2xs text-muted-foreground mt-3xs tabular-nums">{meta}</div>
                ) : null}
                <div className="text-2xs text-muted-foreground tabular-nums">{row.barcode}</div>
                {hasCommissionTariffWarning(row) ? (
                  <div className="mt-2xs flex">
                    <MarketplaceCampaignTariffWarning />
                  </div>
                ) : null}
              </div>
            </div>

            {/* Zone 2: the campaign-free baseline both price cards are compared with. */}
            <div className="border-border pt-md flex flex-col border-t">
              <span className="text-2xs text-muted-foreground mb-2xs font-medium">
                {t('currentPrice')}
              </span>
              <MarketplaceCampaignCurrentCell row={row} />
            </div>

            {/* Zone 3: the maximum price Trendyol allows. */}
            <div className="border-border pt-md flex flex-col border-t">
              <span className="text-2xs text-muted-foreground mb-2xs font-medium">
                {t('maxPrice')}
              </span>
              <MarketplaceCampaignMaxPriceCell
                row={row}
                presentation={presentation}
                selected={selection[row.id] === 'MAX'}
                customPrice={price}
                onToggle={() => onToggleChoice(row, 'MAX')}
              />
            </div>

            {/* Zone 4: the seller's own price (the cell labels itself below md). */}
            <div className="border-border pt-md border-t">
              <MarketplaceCampaignCustomPriceCell
                row={row}
                presentation={presentation}
                price={price}
                selected={selection[row.id] === 'CUSTOM'}
                onPriceChange={onCustomPriceChange}
                onToggle={() => onToggleChoice(row, 'CUSTOM')}
                targetMarginMark={targetMarginMarks[row.id] ?? null}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
