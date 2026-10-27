'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useCustomPriceWhatIf } from '../hooks/use-custom-price-what-if';
import { useDiscountReasonEmptyLabel } from '../hooks/use-discount-reason-label';
import { useEstimateCampaignItem } from '../hooks/use-estimate-campaign-item';
import type {
  CampaignScenarioPresentation,
  MarketplaceCampaignRow,
} from '../lib/adapt-marketplace-campaign';
import {
  campaignOptionFigures,
  campaignRowBestOption,
  estimateOptionFigures,
} from '../lib/marketplace-campaign-selection';
import { useTariffScope } from '../lib/tariff-scope';
import { MarketplaceCampaignBreakdown } from './marketplace-campaign-breakdown';
import { CampaignOptionDetails } from './marketplace-campaign-option-details';
import { TariffBestRibbon } from './tariff-best-ribbon';
import { TariffOptionCard } from './tariff-option-card';
import { TariffProfitBlock } from './tariff-profit-block';
import { TariffSelectFoot } from './tariff-select-foot';

export interface MarketplaceCampaignMaxPriceCellProps {
  row: MarketplaceCampaignRow;
  /** UNIT rows show the per-unit scenario; ORDER rows the assumed order at this price. */
  presentation: CampaignScenarioPresentation;
  /** Whether the row joins the campaign at the maximum price. */
  selected: boolean;
  /** The row's buffered custom price — the rival this card races for the "En kârlı" ribbon. */
  customPrice: string | null;
  /** Toggles joining at the maximum price (re-choosing clears it). */
  onToggle: () => void;
}

/**
 * The "Maksimum Girebileceğin Fiyat" option as a CLICKABLE CARD — the whole {@link
 * TariffOptionCard} is the select target (a stretched-overlay button), exactly like a Flash offer.
 * The price Trendyol allows is the hero; below it, on an ORDER row, the assumed order and what the
 * customer pays for it, then the commission, the profit block (unit profit, or the order profit
 * against the same order campaign-free) and the select foot. The figures come from the row's
 * maximum scenario + basket block; nothing is computed here.
 *
 * A11y: the overlay `<button>` is a SIBLING of the ProfitBadge (itself a `<button>` opening the
 * breakdown), never an ancestor — nested buttons are invalid HTML and break hydration.
 */
export function MarketplaceCampaignMaxPriceCell({
  row,
  presentation,
  selected,
  customPrice,
  onToggle,
}: MarketplaceCampaignMaxPriceCellProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.table');
  const reasonEmptyLabel = useDiscountReasonEmptyLabel();
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateCampaignItem(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  const figures = campaignOptionFigures(presentation, row.maxScenario, row.maxBasket, row.current);
  const orderFramed = figures.order !== null;
  // The same what-if the custom card shows (one shared request): the ribbon follows the typed
  // price before it is saved.
  const whatIf = useCustomPriceWhatIf(row, customPrice);
  const isBest =
    campaignRowBestOption(
      row,
      presentation,
      customPrice,
      whatIf.result !== null && customPrice !== null
        ? { price: customPrice, figures: estimateOptionFigures(whatIf.result, row.current) }
        : undefined,
    ) === 'max';

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { scenario: 'max' } });
  }

  return (
    <TariffOptionCard selected={selected} interactive>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t('selectMaxAria', { product: row.productTitle })}
        onClick={onToggle}
        // Tailwind v4 strips the native button cursor; the overlay covers the whole card.
        className="focus-visible:shadow-focus absolute inset-0 cursor-pointer rounded-md focus-visible:outline-none"
      />

      {isBest ? <TariffBestRibbon label={t('bestOption')} /> : null}

      <div className="gap-3xs flex min-w-0 flex-col items-start">
        <span className="text-base font-bold tabular-nums">{formatCurrency(row.maxPrice)}</span>
        <CampaignOptionDetails
          order={figures.order}
          commissionPct={row.maxScenario.commissionPct}
          commissionBands={row.commissionBands}
        />
      </div>

      <TariffProfitBlock
        netProfit={figures.netProfit}
        marginPct={figures.marginPct}
        currentNetProfit={figures.baselineNetProfit}
        scale={scale}
        onOpenBreakdown={openBreakdown}
        emptyLabel={reasonEmptyLabel(row.reason)}
        calculatedLabel={orderFramed ? t('orderProfit') : t('calculatedProfit')}
        vsCurrentLabel={orderFramed ? t('vsWithoutCampaign') : t('vsCurrent')}
      />

      {/* Visual foot only — the card overlay owns the click. */}
      <TariffSelectFoot
        selected={selected}
        label={t('selectPrice')}
        selectedLabel={t('selected')}
      />

      <MarketplaceCampaignBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        stockCode={row.barcode}
        campaignPrice={row.maxPrice}
        result={estimate.data ?? null}
        loading={estimate.isPending}
        currentNetProfit={row.current.netProfit}
      />
    </TariffOptionCard>
  );
}
