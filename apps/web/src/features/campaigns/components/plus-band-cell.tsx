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

import { useEstimatePlusItemPrice } from '../hooks/use-estimate-plus-item-price';
import { useTariffScope } from '../lib/tariff-scope';
import type { PlusTariffDetailItem } from '../types';
import { PlusTariffBreakdown } from './plus-tariff-breakdown';

export interface PlusBandCellProps {
  row: PlusTariffDetailItem;
  /** Whether the seller has joined Plus for this product. */
  selected: boolean;
  /** Toggle the join state (re-tap un-joins). */
  onToggle: () => void;
  /**
   * Show an explicit "Plus'e Katıl / Katıldın" action word beside the radio (and
   * drop the price to its own line). ON for the mobile cards — there is no column
   * header there to say what the box is, so the action word makes the toggle's
   * purpose obvious at a glance. OFF (default) in the desktop table, where the
   * "trendyol plus Fiyat Aralığı" column header already labels the offer.
   */
  showJoinLabel?: boolean;
}

/**
 * The Plus offer as ONE selectable "join" card — the direct analog of the
 * commission {@link PriceBandCell}, adapted to the single-offer Plus model. Same
 * skeleton as a price band: the Plus price CEILING (with its "ve altı" qualifier
 * as one unit) is the hero, since dropping the price to it is what earns the
 * reduced Plus commission shown below, and the shared {@link ProfitBadge} carries
 * the profit/margin. Only the campaign LOGIC differs — selection is a join TOGGLE
 * (join / un-join), not a 4-band pick.
 *
 * Interaction mirrors PriceBandCell: a stretched-button overlay makes the whole
 * card the toggle target; the content is `pointer-events-none` so clicks fall
 * through, EXCEPT the profit badge (`pointer-events-auto`) which opens the
 * breakdown modal (figures from the backend estimate at the Plus price).
 */
export function PlusBandCell({
  row,
  selected,
  onToggle,
  showJoinLabel = false,
}: PlusBandCellProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage.table');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimatePlusItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { price: row.plus.price } });
  }

  // The Plus ceiling price + its "ve altı" qualifier as one unit — the hero when
  // the offer stands alone (desktop), or the second line under the join action
  // word (mobile). flex-wrap drops the qualifier under the price on a narrow card.
  const priceUnit = (
    <span className="gap-x-2xs flex min-w-0 flex-wrap items-baseline">
      <span className="text-base font-bold tabular-nums">{formatCurrency(row.plus.price)}</span>
      <span className="text-xs font-normal">{t('ceilingQualifier')}</span>
    </span>
  );

  return (
    <div
      className={cn(
        // Mirrors PriceBandCell: min-w-0 on mobile so the card fits its track; the
        // 200px floor only applies in the desktop table (md+). hover-lift: the whole
        // card is the toggle target, so the shadow rise honestly advertises it.
        'p-xs md:min-w-tariff-band hover-lift relative min-w-0 rounded-md border',
        // Joined state stays QUIET: a thin primary border + the checkmark carry the
        // selection over the muted surface-row-selected fill, so the profit badge
        // remains the dominant color in the card, not the selection.
        selected ? 'border-primary bg-surface-row-selected' : 'border-border',
      )}
    >
      {/* Stretched toggle button: covers the whole card so clicking anywhere
          (except the profit badge) joins / un-joins the product. */}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${selected ? t('joined') : t('join')} — ${row.productTitle}`}
        onClick={onToggle}
        className={cn(
          'duration-fast ease-out-quart absolute inset-0 cursor-pointer rounded-md transition-colors',
          'focus-visible:shadow-focus focus-visible:outline-none',
          !selected && 'hover:bg-muted',
        )}
      />

      {/* Content above the overlay; pointer-events-none lets clicks fall through to
          the toggle button, except the profit badge (pointer-events-auto). */}
      <div className="gap-2xs pointer-events-none relative flex flex-col">
        <span className="gap-2xs flex min-w-0 items-center">
          {selected ? (
            <CheckmarkCircle02Icon className="text-primary size-4 shrink-0" aria-hidden />
          ) : (
            <CircleIcon className="text-border-strong size-4 shrink-0" aria-hidden />
          )}
          {showJoinLabel ? (
            <span className="text-sm font-medium">{selected ? t('joined') : t('join')}</span>
          ) : (
            priceUnit
          )}
        </span>

        {/* Mobile: the price sits on its own line under the join action word. */}
        {showJoinLabel ? priceUnit : null}

        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('plusCommission')} {formatPercentDisplay(row.plus.commissionPct)}
        </span>

        <ProfitBadge
          value={row.plus.netProfit}
          marginPct={row.plus.marginPct}
          scale={scale}
          onOpen={openBreakdown}
          showMarginPct
          className="mt-3xs pointer-events-auto self-start"
        />
      </div>

      {/* "Plus daha kârlı" ribbon: the Plus analog of the commission "En kârlı"
          band ribbon — pinned to the card's top edge, solid brand tone, shown only
          when joining Plus nets more than the current price/commission. Green stays
          reserved for the profit badge. pointer-events-none so a click still toggles. */}
      {row.plusIsBetter ? (
        <Badge
          tone="primary"
          variant="solid"
          radius="full"
          leadingIcon={<SparklesIcon />}
          className="text-2xs px-2xs -top-xs right-xs gap-3xs pointer-events-none absolute py-0 font-medium shadow-xs [&_svg]:size-3"
        >
          {t('plusIsBetter')}
        </Badge>
      ) : null}

      <PlusTariffBreakdown
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
