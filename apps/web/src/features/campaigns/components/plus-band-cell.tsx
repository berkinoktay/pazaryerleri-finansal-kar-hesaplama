'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useEstimatePlusItemPrice } from '../hooks/use-estimate-plus-item-price';
import { usePlusReasonEmptyLabel } from '../hooks/use-plus-reason-label';
import type { PlusBand, PlusTariffRow } from '../lib/adapt-plus-tariff';
import { useTariffScope } from '../lib/tariff-scope';
import { PlusTariffBreakdown } from './plus-tariff-breakdown';
import { TariffBestRibbon } from './tariff-best-ribbon';
import { TariffOptionCard } from './tariff-option-card';
import { TariffProfitBlock } from './tariff-profit-block';
import { TariffSelectFoot } from './tariff-select-foot';

export interface PlusBandCellProps {
  row: PlusTariffRow;
  /** The single Plus offer (the row's one-element `bands`). */
  band: PlusBand;
  /** Whether the seller has joined Plus AT THE CEILING for this product. */
  selected: boolean;
  /** Whether keeping the Plus offer is the row's most profitable option (a quiet "En kârlı" ribbon). */
  isBest?: boolean;
  /** Toggle the ceiling join (re-clicking un-joins). */
  onSelect: () => void;
}

/**
 * The Plus offer as a CLICKABLE CARD — the whole {@link TariffOptionCard} is the select
 * target (a stretched-overlay button), so the seller joins Plus by clicking anywhere on
 * it, exactly like a commission price band. Left-aligned: the ceiling PRICE (with its
 * "ve altı" qualifier) is the hero, then the reduced Plus commission, the shared {@link
 * TariffProfitBlock}, and a {@link TariffSelectFoot} ("Tavan fiyata katıl" ring →
 * "Katıldın" tick). Selected = brand border + soft brand fill + a featured "En kârlı"
 * ribbon when the offer wins the row.
 *
 * Joining is a TOGGLE (join OR not) owned by the parent: joining clears any custom
 * price; re-clicking un-joins.
 *
 * A11y: the overlay `<button>` is a SIBLING of the ProfitBadge (which is itself a
 * `<button>` opening the breakdown), never an ancestor — nesting `<button>` in
 * `<button>` is invalid HTML and breaks hydration. The badge (and the ribbon) are
 * raised (`z-10`) so the badge's click still reaches it; the price, commission and
 * foot sit below the overlay and select.
 */
export function PlusBandCell({
  row,
  band,
  selected,
  isBest = false,
  onSelect,
}: PlusBandCellProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage.table');
  const reasonEmptyLabel = usePlusReasonEmptyLabel();
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimatePlusItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { price: band.price } });
  }

  return (
    <TariffOptionCard selected={selected} interactive>
      {/* Stretched-overlay select target. Sibling of the ProfitBadge (never an
          ancestor) so the badge's own <button> is not nested inside it. Price,
          commission and the foot ring sit below the overlay → clicking them joins. */}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={selected ? t('joined') : t('join')}
        onClick={onSelect}
        // Tailwind v4 strips the native button cursor; the overlay covers the whole
        // card, so its cursor is what the seller sees hovering the offer.
        className="focus-visible:shadow-focus absolute inset-0 cursor-pointer rounded-md focus-visible:outline-none"
      />

      {/* "En kârlı" — a featured ribbon straddling the top border. Absolute, so it
          adds NO height. pointer-events-none → clicking it still joins via the
          overlay. Only shown when the Plus offer wins the row. */}
      {isBest ? <TariffBestRibbon label={t('best')} /> : null}

      {/* Ceiling price + its "ve altı" qualifier as one hero unit, then the reduced
          Plus commission. */}
      <div className="gap-3xs flex min-w-0 flex-col items-start">
        <span className="gap-x-2xs flex min-w-0 flex-wrap items-baseline">
          <span className="text-base font-bold tabular-nums">{formatCurrency(band.price)}</span>
          <span className="text-xs font-normal">{t('ceilingQualifier')}</span>
        </span>
        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('plusCommission')} {formatPercentDisplay(band.commissionPct)}
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
      <TariffSelectFoot selected={selected} label={t('join')} selectedLabel={t('joined')} />

      <PlusTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        stockCode={row.stockCode}
        currentNetProfit={row.currentNetProfit}
        result={estimate.data ?? null}
        loading={estimate.isPending}
      />
    </TariffOptionCard>
  );
}
