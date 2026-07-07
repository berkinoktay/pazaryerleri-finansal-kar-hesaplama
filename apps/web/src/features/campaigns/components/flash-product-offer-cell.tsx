'use client';

import { Clock01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { Badge } from '@/components/ui/badge';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useEstimateFlashItemPrice } from '../hooks/use-estimate-flash-item-price';
import { useFlashReasonEmptyLabel } from '../hooks/use-flash-reason-label';
import { type FlashBand, type FlashProductRow } from '../lib/adapt-flash-product';
import { useTariffScope } from '../lib/tariff-scope';
import { FlashProductBreakdown } from './flash-product-breakdown';
import { TariffBestRibbon } from './tariff-best-ribbon';
import { TariffOptionCard } from './tariff-option-card';
import { TariffProfitBlock } from './tariff-profit-block';
import { TariffSelectFoot } from './tariff-select-foot';

export interface FlashProductOfferCellProps {
  row: FlashProductRow;
  /** The flash offer this cell renders (one of the row's up-to-two dated offers). */
  band: FlashBand;
  /** The offer slot's human name ("24 Saatlik" / "3 Saatlik") — heads the a11y label. */
  slotLabel: string;
  /** Whether the seller has chosen THIS offer for the row. */
  selected: boolean;
  /** Whether choosing this offer is the row's most profitable option (a quiet "En kârlı" ribbon). */
  isBest?: boolean;
  /** Toggle choosing this offer (re-tap clears it; choosing clears the other offer/custom). */
  onSelect: () => void;
}

/**
 * One flash offer (24 Saatlik / 3 Saatlik) as a CLICKABLE CARD — the whole {@link
 * TariffOptionCard} is the select target (a stretched-overlay button), so the seller
 * chooses the offer by clicking anywhere on it, exactly like an Advantage star tier or the
 * Plus offer. The card is HEADED by the offer's TIME RANGE — a high-contrast solid, clock-led
 * {@link Badge} ("00:00–23:59"), no live countdown so it stays SSR safe. The row's DATE lives
 * in the product-identity cell instead (see {@link FlashDayBadge}), since the same product
 * recurs across dated rows. Below the header:
 * the flash PRICE (hero), the reduced commission, the shared {@link TariffProfitBlock}, and a
 * {@link TariffSelectFoot}. Selected = brand border + soft brand fill + a featured "En kârlı"
 * ribbon when the offer wins the row.
 *
 * Choosing is a TOGGLE owned by the parent: choosing clears any custom price and the other
 * offer (1-of-4 per row); re-clicking clears the offer.
 *
 * A11y: the overlay `<button>` is a SIBLING of the ProfitBadge (which is itself a
 * `<button>` opening the breakdown), never an ancestor — nesting `<button>` in `<button>`
 * is invalid HTML and breaks hydration.
 */
export function FlashProductOfferCell({
  row,
  band,
  slotLabel,
  selected,
  isBest = false,
  onSelect,
}: FlashProductOfferCellProps): React.ReactElement {
  const t = useTranslations('flashProductsPage.table');
  const reasonEmptyLabel = useFlashReasonEmptyLabel();
  const format = useFormatter();
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateFlashItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { price: band.price } });
  }

  // Static time-range header — "00:00–23:59" — rendered from the offer's fixed ISO dates
  // (deterministic, so SSR-safe: no Date.now()). The date is shown once per row in the
  // product cell (FlashDayBadge), not here. Falls back to nothing if the file left the
  // window blank (never expected for a present offer).
  const timeLabel =
    band.startsAt !== null
      ? t('offerTime', {
          start: format.dateTime(new Date(band.startsAt), 'time'),
          end: band.endsAt !== null ? format.dateTime(new Date(band.endsAt), 'time') : '',
        })
      : null;

  return (
    <TariffOptionCard selected={selected} interactive>
      {/* Stretched-overlay select target. Sibling of the ProfitBadge (never an ancestor)
          so the badge's own <button> is not nested inside it. */}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={selected ? t('offerSelected') : t('selectOffer', { slot: slotLabel })}
        onClick={onSelect}
        // Tailwind v4 strips the native button cursor; the overlay covers the whole card,
        // so its cursor is what the seller sees hovering the offer.
        className="focus-visible:shadow-focus absolute inset-0 cursor-pointer rounded-md focus-visible:outline-none"
      />

      {/* "En kârlı" — a featured ribbon straddling the top border. Absolute, so it adds NO
          height. pointer-events-none → clicking it still chooses via the overlay. */}
      {isBest ? <TariffBestRibbon label={t('bestOffer')} /> : null}

      {/* Time-range header — a high-contrast solid, clock-led time-range badge (a dark pill;
          inverted in dark mode) so the window reads at a glance. The row's DATE is shown in the
          product cell (FlashDayBadge), never here. */}
      {timeLabel !== null ? (
        <Badge
          tone="neutral"
          variant="solid"
          size="sm"
          leadingIcon={<Clock01Icon />}
          className="tabular-nums"
        >
          {timeLabel}
        </Badge>
      ) : null}

      {/* Flash price (the exact offer price — not a ceiling) then the reduced commission. */}
      <div className="gap-3xs flex min-w-0 flex-col items-start">
        <span className="text-base font-bold tabular-nums">{formatCurrency(band.price)}</span>
        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('offerCommission')} {formatPercentDisplay(band.commissionPct)}
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
        label={t('selectOfferShort')}
        selectedLabel={t('offerSelected')}
      />

      <FlashProductBreakdown
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
