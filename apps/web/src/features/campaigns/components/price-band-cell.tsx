'use client';

import { CheckmarkCircle02Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { ProfitBadge } from '@/components/patterns/profit-badge';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { cn } from '@/lib/utils';

import { buildBandBreakdown } from '../lib/build-band-breakdown';
import type { BandKey, CommissionTariffRow, PriceBand } from '../types';
import { CommissionTariffBreakdown } from './commission-tariff-breakdown';

export interface PriceBandCellProps {
  row: CommissionTariffRow;
  band: PriceBand;
  /** Whether the seller has chosen this band for the product. */
  selected: boolean;
  /** Whether this is the most profitable band (a quiet "En iyi" label, not a colored surface). */
  isBest?: boolean;
  /** Whether this is the product's current range (band1) — drives the breakdown's
   *  sale price (live `currentPrice` vs the band threshold). No longer a label. */
  isCurrent?: boolean;
  onSelect: (key: BandKey) => void;
}

/**
 * One price band as a selectable toggle card. The PRICE (with its "ve altı / ve
 * üzeri" qualifier as one unit) is the hero — it is what the seller is choosing.
 *
 * Selection is a TOGGLE (one OR none per product): clicking a band selects it,
 * clicking the selected band again clears it — not a radio group (the seller
 * must be able to undo a choice). The parent owns the toggle logic.
 *
 * Interaction (stretched-button overlay): a full-card toggle `<button>` sits
 * behind the content so clicking anywhere toggles the band; the content is
 * `pointer-events-none` so clicks fall through, EXCEPT the shared {@link
 * ProfitBadge} which re-enables pointer events and opens the income/expense
 * breakdown modal. The badge is the SAME component the orders page uses.
 */
export function PriceBandCell({
  row,
  band,
  selected,
  isBest = false,
  isCurrent = false,
  onSelect,
}: PriceBandCellProps): React.ReactElement {
  const format = useFormatter();
  const t = useTranslations('commissionTariffsPage.table');
  const scale = useMarginColoring();
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  // thresholdLabel is "<price>₺ <qualifier>" (e.g. "777,09₺ ve altı"); split so
  // the price can be the hero while the qualifier sits right beside it as one unit.
  const [priceText, ...qualifierParts] = band.thresholdLabel.split(' ');
  const qualifier = qualifierParts.join(' ');

  return (
    <div
      className={cn(
        'p-xs min-w-tariff-band relative rounded-md border',
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
            <span className="gap-2xs flex min-w-0 items-baseline">
              <span className="text-base font-bold tabular-nums">{priceText}</span>
              <span className="truncate text-xs font-normal">{qualifier}</span>
            </span>
          </span>
          {isBest ? (
            <span className="text-2xs text-success shrink-0 font-semibold">{t('best')}</span>
          ) : null}
        </span>

        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('commission')} {format.number(band.commissionPct.toNumber(), 'percent')}
        </span>

        <ProfitBadge
          value={band.profit}
          marginPct={band.marginPct}
          scale={scale}
          onOpen={() => setBreakdownOpen(true)}
          className="pointer-events-auto self-start"
        />
      </div>

      <CommissionTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        breakdown={buildBandBreakdown(row, band, isCurrent)}
      />
    </div>
  );
}
