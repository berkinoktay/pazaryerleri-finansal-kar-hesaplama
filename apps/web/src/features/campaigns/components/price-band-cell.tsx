'use client';

import { CheckmarkCircle02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { ProfitBadge } from '@/components/patterns/profit-badge';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { cn } from '@/lib/utils';

import { useEstimateItemPrice } from '../hooks/use-estimate-item-price';
import { asBandKey } from '../lib/band-key';
import { useTariffScope } from '../lib/tariff-scope';
import type { CommissionTariffRow, PriceBand } from '../types';
import { CommissionTariffBreakdown } from './commission-tariff-breakdown';

export interface PriceBandCellProps {
  row: CommissionTariffRow;
  band: PriceBand;
  /** Whether the seller has chosen this band for the product. */
  selected: boolean;
  /** Whether this is the most profitable band (a quiet "En iyi" label, not a colored surface). */
  isBest?: boolean;
  onSelect: (key: string) => void;
}

/** The band's boundary price + its "ve altı / ve üzeri" qualifier as one hero unit. */
function useBandLabel(band: PriceBand): { priceText: string; qualifier: string } {
  const t = useTranslations('commissionTariffsPage.table');
  // band1 has no upper bound → show its lower bound + "ve üzeri"; every other band
  // shows its upper bound + "ve altı" (the ceiling the seller drops the price to).
  if (band.upperLimit !== null) {
    return { priceText: formatCurrency(band.upperLimit), qualifier: t('belowQualifier') };
  }
  if (band.lowerLimit !== null) {
    return { priceText: formatCurrency(band.lowerLimit), qualifier: t('aboveQualifier') };
  }
  return { priceText: formatCurrency(band.price), qualifier: '' };
}

/**
 * One price band as a selectable toggle card. The PRICE (with its "ve altı / ve
 * üzeri" qualifier as one unit) is the hero — it is what the seller is choosing.
 *
 * Selection is a TOGGLE (one OR none per product): clicking a band selects it,
 * clicking the selected band again clears it. The parent owns the toggle logic.
 *
 * Interaction (stretched-button overlay): a full-card toggle `<button>` sits
 * behind the content so clicking anywhere toggles the band; the content is
 * `pointer-events-none` so clicks fall through, EXCEPT the shared {@link
 * ProfitBadge} which re-enables pointer events and opens the breakdown modal.
 * The modal's figures come from the backend estimate at this band's price.
 */
export function PriceBandCell({
  row,
  band,
  selected,
  isBest = false,
  onSelect,
}: PriceBandCellProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.table');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimateItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const { priceText, qualifier } = useBandLabel(band);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { price: band.price, bandKey: asBandKey(band.key) } });
  }

  return (
    <div
      className={cn(
        // min-w-0 on mobile so the card shrinks to fit its 2-col grid track (no
        // overlap); the 200px floor only applies in the desktop table (md+),
        // where the band columns scroll horizontally rather than squish.
        'p-xs md:min-w-tariff-band relative min-w-0 rounded-md border',
        selected ? 'border-primary bg-primary-soft' : 'border-border',
      )}
    >
      {/* Stretched select button: covers the whole card so clicking anywhere
          (except the profit badge above) picks this band. */}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${priceText} ${qualifier}`}
        onClick={() => onSelect(band.key)}
        className={cn(
          'duration-fast ease-out-quart absolute inset-0 cursor-pointer rounded-md transition-colors',
          'focus-visible:shadow-focus focus-visible:outline-none',
          !selected && 'hover:bg-muted',
        )}
      />

      {/* Content above the overlay; pointer-events-none lets clicks fall through
          to the select button, except the badge (pointer-events-auto). */}
      <div className="gap-2xs pointer-events-none relative flex flex-col">
        <span className="gap-2xs flex items-center justify-between">
          <span className="gap-2xs flex min-w-0 items-center">
            {selected ? (
              <CheckmarkCircle02Icon className="text-primary size-4 shrink-0" aria-hidden />
            ) : (
              <span
                className="border-border-strong size-4 shrink-0 rounded-full border-2"
                aria-hidden
              />
            )}
            {/* flex-wrap: when the "ve altı / ve üzeri" qualifier doesn't fit
                beside the price (narrow band card / mobile), it drops to the next
                line under the price rather than being truncated. */}
            <span className="gap-x-2xs flex min-w-0 flex-wrap items-baseline">
              <span className="text-base font-bold tabular-nums">{priceText}</span>
              <span className="text-xs font-normal">{qualifier}</span>
            </span>
          </span>
          {isBest ? (
            <span className="text-2xs text-success shrink-0 font-semibold">{t('best')}</span>
          ) : null}
        </span>

        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('commission')} {formatPercentDisplay(band.commissionPct)}
        </span>

        <ProfitBadge
          value={band.netProfit}
          marginPct={band.marginPct}
          scale={scale}
          onOpen={openBreakdown}
          className="pointer-events-auto self-start"
        />
      </div>

      <CommissionTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        result={estimate.data ?? null}
        loading={estimate.isPending}
      />
    </div>
  );
}
