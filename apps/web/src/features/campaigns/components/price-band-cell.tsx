'use client';

import { CheckmarkCircle02Icon, CircleIcon, SparklesIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { ProfitBadge } from '@/components/patterns/profit-badge';
import { Badge } from '@/components/ui/badge';
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
        // Selected state stays QUIET: a thin primary border + the checkmark carry
        // the selection, over the muted `surface-row-selected` fill (chroma 0.012)
        // rather than the loud brand `primary-soft` (chroma 0.04) — so the green/red
        // profit badge remains the dominant color in the card, not the selection.
        selected ? 'border-primary bg-surface-row-selected' : 'border-border',
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
          to the select button, except the profit badge (pointer-events-auto). */}
      <div className="gap-2xs pointer-events-none relative flex flex-col">
        <span className="gap-2xs flex min-w-0 items-center">
          {/* Both states come from the same icon family so the toggle reads as
              one control: an outlined circle that becomes a checked circle
              (matching stroke weight — a border-2 span looked heavier/bigger). */}
          {selected ? (
            <CheckmarkCircle02Icon className="text-primary size-4 shrink-0" aria-hidden />
          ) : (
            <CircleIcon className="text-border-strong size-4 shrink-0" aria-hidden />
          )}
          {/* flex-wrap: when the "ve altı / ve üzeri" qualifier doesn't fit
              beside the price (narrow band card / mobile), it drops to the next
              line under the price rather than being truncated. */}
          <span className="gap-x-2xs flex min-w-0 flex-wrap items-baseline">
            <span className="text-base font-bold tabular-nums">{priceText}</span>
            <span className="text-xs font-normal">{qualifier}</span>
          </span>
        </span>

        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('commission')} {formatPercentDisplay(band.commissionPct)}
        </span>

        <ProfitBadge
          value={band.netProfit}
          marginPct={band.marginPct}
          scale={scale}
          onOpen={openBreakdown}
          showMarginPct
          // mt-3xs on top of the column's gap-2xs: the seller flagged the badge
          // sitting too close to the commission line above it.
          className="mt-3xs pointer-events-auto self-start"
        />
      </div>

      {/* "En kârlı" ribbon: absolutely pinned to the card's TOP edge (poking up
          over the border) so it reads as a "featured" tab rather than taking a
          slot in the content row. Solid BRAND tone — green stays reserved for the
          profit badge, and a solid brand pill keeps its contrast on any row-hover
          surface. pointer-events-none so a click still selects the band.
          Stacking: rendered LAST with NO z-index — DOM order paints it above the
          card's own button/content, while the table's pinned product column
          (sticky z-10) still covers it when the bands scroll beneath. */}
      {isBest ? (
        <Badge
          tone="primary"
          variant="solid"
          radius="full"
          leadingIcon={<SparklesIcon />}
          // Slim, compact ribbon: py-0 + a smaller icon + tight horizontal padding
          // keep it short enough that its lower half tucks INTO the card's top
          // padding instead of overlapping the price/checkmark row below it.
          className="text-2xs px-2xs -top-xs right-xs gap-3xs pointer-events-none absolute py-0 font-medium shadow-xs [&_svg]:size-3"
        >
          {t('best')}
        </Badge>
      ) : null}

      <CommissionTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        result={estimate.data ?? null}
        loading={estimate.isPending}
      />
    </div>
  );
}
