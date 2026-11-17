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
 *
 * An offer whose Plus commission percent is unknown (the file's cell was blank or
 * unreadable) shows that line as "Plus commission Unknown" with its own caption under
 * it, has no profit and never wears the "best" ribbon. The backend refuses any join on
 * it (also with a custom price), so it cannot be joined either: no select target, a
 * "Cannot be selected" foot, and the same un-join escape hatch when it is already
 * joined. With both the price and the commission unknown, both captions show. The
 * badge click opens the not-calculable dialog without an estimate request.
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
  const commissionUnknown = band.commissionPct === null;
  // No ceiling or no Plus commission: nothing to estimate at (the backend refuses both),
  // no profit, never the row's best, and never newly joinable.
  const offerUnknown = priceUnknown || commissionUnknown;
  // An unknown offer can only be un-joined, never newly joined.
  const selectable = !offerUnknown || selected;

  function openBreakdown(): void {
    setBreakdownOpen(true);
    // The dialog opens on its not-calculable text without a request.
    if (band.price === null || offerUnknown) return;
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
          no price or no Plus commission. */}
      {isBest && !offerUnknown ? <TariffBestRibbon label={t('best')} /> : null}

      {/* Ceiling price + its "ve altı" qualifier as one hero unit, then the reduced
          Plus commission. An unknown ceiling reads muted, never as an amount. */}
      <div className="gap-3xs flex min-w-0 flex-col items-start">
        {band.price === null ? (
          // The unknown label and, on its own line under it, why and the way out
          // (a custom price): plain text, so it reads on touch devices too. With the Plus
          // commission unknown too there is no way out (a custom price cannot join
          // either), so only the commission caption below explains the card.
          <TariffUnknownPrice
            label={t('priceUnknown')}
            hint={band.commissionPct === null ? undefined : t('plusPriceUnknownHint')}
          />
        ) : (
          <span className="gap-x-2xs flex min-w-0 flex-wrap items-baseline">
            <span className="text-base font-bold tabular-nums">{formatCurrency(band.price)}</span>
            <span className="text-xs font-normal">{t('ceilingQualifier')}</span>
          </span>
        )}
        {band.commissionPct === null ? (
          // The unknown commission line and, under it, why it cannot be joined.
          <TariffUnknownPrice
            size="line"
            label={`${t('plusCommission')} ${t('commissionUnknown')}`}
            hint={t('plusCommissionUnknownHint')}
          />
        ) : (
          <span className="text-2xs text-muted-foreground tabular-nums">
            {t('plusCommission')} {formatPercentDisplay(band.commissionPct)}
          </span>
        )}
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
        result={offerUnknown ? null : (estimate.data ?? null)}
        loading={offerUnknown ? false : estimate.isPending}
      />
    </TariffOptionCard>
  );
}
