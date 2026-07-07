'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import type { AdvantageBand, AdvantageTariffRow } from '../lib/adapt-advantage-tariff';
import { useAdvantageReasonEmptyLabel } from '../hooks/use-advantage-reason-label';
import { useEstimateAdvantageItemPrice } from '../hooks/use-estimate-advantage-item-price';
import { useTariffScope } from '../lib/tariff-scope';
import { AdvantageTariffBreakdown } from './advantage-tariff-breakdown';
import { TariffBestRibbon } from './tariff-best-ribbon';
import { TariffOptionCard } from './tariff-option-card';
import { TariffProfitBlock } from './tariff-profit-block';
import { TariffSelectFoot } from './tariff-select-foot';

export interface AdvantageTierCellProps {
  row: AdvantageTariffRow;
  /** The tier this cell renders (one of the row's up-to-three star tiers). */
  band: AdvantageBand;
  /** Whether the seller has chosen THIS tier for the product. */
  selected: boolean;
  /** Whether choosing this tier is the row's most profitable option (a quiet "En kârlı" ribbon). */
  isBest?: boolean;
  /** Toggle choosing this tier (re-tap clears it; choosing clears the other tiers/custom). */
  onSelect: () => void;
}

/**
 * One Advantage star tier as a CLICKABLE CARD — the whole {@link TariffOptionCard} is the
 * select target (a stretched-overlay button), so the seller chooses the tier by clicking
 * anywhere on it, exactly like a commission price band or the Plus offer. Left-aligned:
 * the tier target PRICE (with its "ve altı" qualifier) is the hero, then the reduced tier
 * commission, the shared {@link TariffProfitBlock}, and a {@link TariffSelectFoot} ("Bu
 * kademeyi seç" ring → "Seçildi" tick). Selected = brand border + soft brand fill + a
 * featured "En kârlı" ribbon when the tier wins the row.
 *
 * Choosing is a TOGGLE owned by the parent: choosing clears any custom price and the other
 * tiers (1-of-4 per product); re-clicking clears the tier.
 *
 * A11y: the overlay `<button>` is a SIBLING of the ProfitBadge (which is itself a
 * `<button>` opening the breakdown), never an ancestor — nesting `<button>` in `<button>`
 * is invalid HTML and breaks hydration. The badge (and the ribbon) are raised (`z-10`) so
 * the badge's click still reaches it; the price, commission and foot sit below the overlay
 * and select.
 */
export function AdvantageTierCell({
  row,
  band,
  selected,
  isBest = false,
  onSelect,
}: AdvantageTierCellProps): React.ReactElement {
  const t = useTranslations('productLabelsPage.table');
  const reasonEmptyLabel = useAdvantageReasonEmptyLabel();
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateAdvantageItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { price: band.price } });
  }

  return (
    <TariffOptionCard selected={selected} interactive>
      {/* Stretched-overlay select target. Sibling of the ProfitBadge (never an ancestor)
          so the badge's own <button> is not nested inside it. Price, commission and the
          foot ring sit below the overlay → clicking them chooses this tier. */}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={selected ? t('tierSelected') : t('selectTier')}
        onClick={onSelect}
        // Tailwind v4 strips the native button cursor; the overlay covers the whole card,
        // so its cursor is what the seller sees hovering the tier.
        className="focus-visible:shadow-focus absolute inset-0 cursor-pointer rounded-md focus-visible:outline-none"
      />

      {/* "En kârlı" — a featured ribbon straddling the top border. Absolute, so it adds NO
          height. pointer-events-none → clicking it still chooses via the overlay. Only
          shown when this tier wins the row. */}
      {isBest ? <TariffBestRibbon label={t('bestTier')} /> : null}

      {/* Tier target price + its "ve altı" qualifier as one hero unit, then the reduced
          tier commission. */}
      <div className="gap-3xs flex min-w-0 flex-col items-start">
        <span className="gap-x-2xs flex min-w-0 flex-wrap items-baseline">
          <span className="text-base font-bold tabular-nums">{formatCurrency(band.price)}</span>
          <span className="text-xs font-normal">{t('tierQualifier')}</span>
        </span>
        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('tierCommission')} {formatPercentDisplay(band.commissionPct)}
        </span>
      </div>

      <TariffProfitBlock
        netProfit={band.netProfit}
        marginPct={band.marginPct}
        currentNetProfit={row.currentNetProfit}
        scale={scale}
        onOpenBreakdown={openBreakdown}
        // The row's not-calculable reason (or undefined when calculable) rides the empty
        // badge as a warning-soft chip — the same reason-aware signal every option in the
        // row shows, now that the product cell no longer prints it inline.
        emptyLabel={reasonEmptyLabel(row.reason)}
        calculatedLabel={t('calculatedProfit')}
        vsCurrentLabel={t('vsCurrent')}
      />

      {/* Visual foot only — the card overlay owns the click. */}
      <TariffSelectFoot
        selected={selected}
        label={t('selectTier')}
        selectedLabel={t('tierSelected')}
      />

      <AdvantageTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        result={estimate.data ?? null}
        loading={estimate.isPending}
      />
    </TariffOptionCard>
  );
}
