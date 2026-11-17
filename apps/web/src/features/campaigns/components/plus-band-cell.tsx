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
import { TariffUnknownPrice } from './tariff-unknown-price';

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
 *
 * An offer with no price (the file's Plus price upper limit could not be read) shows
 * "Unknown" with a short explanation line under it, has no profit and never wears the
 * "best" ribbon. The backend refuses to store a ceiling join without a price, so
 * while not joined the card has no select target and its foot reads "Cannot be
 * selected" (the seller can still join with a custom price). If it is already joined,
 * the overlay stays so the seller can still un-join it.
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
  const priceUnknown = band.price === null;
  // An offer with no price can only be un-joined, never newly joined at the ceiling.
  const selectable = !priceUnknown || selected;

  function openBreakdown(): void {
    setBreakdownOpen(true);
    // An unknown ceiling has no price to estimate at: the dialog opens with no result.
    if (band.price === null) return;
    estimate.mutate({ itemId: row.id, body: { price: band.price } });
  }

  return (
    <TariffOptionCard selected={selected} interactive={selectable}>
      {/* Stretched-overlay select target. Sibling of the ProfitBadge (never an
          ancestor) so the badge's own <button> is not nested inside it. Price,
          commission and the foot ring sit below the overlay, so clicking them joins.
          Absent on an offer that cannot be joined. */}
      {selectable ? (
        <button
          type="button"
          aria-pressed={selected}
          aria-label={selected ? t('joined') : t('join')}
          onClick={onSelect}
          // Tailwind v4 strips the native button cursor; the overlay covers the whole
          // card, so its cursor is what the seller sees hovering the offer.
          className="focus-visible:shadow-focus absolute inset-0 cursor-pointer rounded-md focus-visible:outline-none"
        />
      ) : null}

      {/* "En kârlı" — a featured ribbon straddling the top border. Absolute, so it
          adds NO height. pointer-events-none → clicking it still joins via the
          overlay. Only shown when the Plus offer wins the row, never on an offer with
          no price. */}
      {isBest && !priceUnknown ? <TariffBestRibbon label={t('best')} /> : null}

      {/* Ceiling price + its "ve altı" qualifier as one hero unit, then the reduced
          Plus commission. An unknown ceiling reads muted, never as an amount. */}
      <div className="gap-3xs flex min-w-0 flex-col items-start">
        {band.price === null ? (
          // The unknown label and, on its own line under it, why and the way out
          // (a custom price): plain text, so it reads on touch devices too.
          <TariffUnknownPrice label={t('priceUnknown')} hint={t('plusPriceUnknownHint')} />
        ) : (
          <span className="gap-x-2xs flex min-w-0 flex-wrap items-baseline">
            <span className="text-base font-bold tabular-nums">{formatCurrency(band.price)}</span>
            <span className="text-xs font-normal">{t('ceilingQualifier')}</span>
          </span>
        )}
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

      {/* Visual foot only: the card overlay owns the click. An offer that cannot be
          joined says so, dimmed like a disabled foot. */}
      <TariffSelectFoot
        selected={selected}
        label={selectable ? t('join') : t('notSelectable')}
        selectedLabel={t('joined')}
        disabled={!selectable}
      />

      <PlusTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        stockCode={row.stockCode}
        currentNetProfit={row.currentNetProfit}
        result={priceUnknown ? null : (estimate.data ?? null)}
        loading={priceUnknown ? false : estimate.isPending}
      />
    </TariffOptionCard>
  );
}
