'use client';

import { StarIcon } from 'hugeicons-react';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { ProfitBadge } from '@/components/patterns/profit-badge';
import { Badge } from '@/components/ui/badge';
import { formatPercentDisplay } from '@/lib/format-percent';
import { type MarginScale } from '@/lib/margin-coloring';
import { cn } from '@/lib/utils';

export interface TariffCurrentCellProps {
  /** The hero price — the amount the buyer currently sees. Printed via `formatCurrency`. */
  price: string;
  /** The current commission %; `null` drops the commission line entirely. */
  commissionPct: string | null;
  /** Label before the commission % ("komisyon" / "Güncel komisyon") — the caller owns the wording. */
  commissionLabel: string;
  /** Label above the profit badge ("Hesaplanan kâr"). */
  calculatedLabel: string;
  /** Backend-computed net profit; `null` renders the (still clickable) empty badge. */
  netProfit: string | null;
  /** Row margin % that tints the badge; `null` → neutral chip. */
  marginPct: string | null;
  /** Active margin scale, else the default ramp. */
  scale: MarginScale | null;
  /** Opens the profit breakdown surface (the badge's click target). */
  onOpenBreakdown: () => void;
  /** What the empty badge shows when `netProfit` is `null` (e.g. "Maliyet girin"); defaults to an em-dash. */
  emptyLabel?: React.ReactNode;
  /**
   * Reserved "En kârlı" slot. `{ label, visible }` renders a star badge whose
   * VISIBILITY is `visible` but whose height is always reserved (keeps the price
   * aligned with the tier columns). `null`/omitted → the slot is not rendered at
   * all, adding no height (the commission-current cell has no "best" concept).
   */
  bestBadge?: { label: string; visible: boolean } | null;
  /**
   * Center the content — the Advantage desktop columns are centered; the
   * commission-current column (and both mobile zones) are left-aligned.
   */
  centered?: boolean;
  /** The caller's breakdown modal (Advantage vs commission use different ones). */
  children?: React.ReactNode;
}

/**
 * Presentational shell for a campaign vertical's CURRENT baseline cell — the "do
 * nothing" reference the seller compares each option against: the price the buyer
 * currently pays (the hero), its current commission, and the calculated profit as
 * the SAME clickable {@link ProfitBadge} the other columns show (info icon, tooltip,
 * opens a breakdown modal). Purely presentational — the caller wires the data, the
 * estimate call, and the breakdown modal (passed as `children`).
 *
 * Shared by two verticals so their current cell reads identically:
 *   - Advantage current ({@link AdvantageCurrentCell}) — centered, with a reserved
 *     "En kârlı" slot (keeping the current price can be the single best option).
 *   - Commission current ({@link CurrentPriceCell}) — left-aligned, no "best" slot.
 */
export function TariffCurrentCell({
  price,
  commissionPct,
  commissionLabel,
  calculatedLabel,
  netProfit,
  marginPct,
  scale,
  onOpenBreakdown,
  emptyLabel,
  bestBadge = null,
  centered = false,
  children,
}: TariffCurrentCellProps): React.ReactElement {
  const items = centered ? 'items-center' : 'items-start';
  const self = centered ? 'self-center' : 'self-start';

  return (
    <div
      className={cn(
        'gap-sm md:min-w-tariff-band flex min-w-0 flex-col',
        items,
        centered && 'w-full text-center',
      )}
    >
      <div className={cn('gap-3xs flex min-w-0 flex-col', items)}>
        {/* Reserved "En kârlı" slot — invisible unless `bestBadge.visible`, but the
            reserved height keeps the price aligned with the tier columns' price rows.
            Omitted entirely when the vertical has no "best" concept. */}
        {bestBadge !== null ? (
          <Badge
            tone="primary"
            variant="solid"
            radius="full"
            leadingIcon={<StarIcon />}
            className={cn(
              'text-2xs px-2xs gap-3xs py-0 font-medium [&_svg]:size-3',
              !bestBadge.visible && 'invisible',
            )}
          >
            {bestBadge.label}
          </Badge>
        ) : null}
        <span className="text-base font-bold tabular-nums">{formatCurrency(price)}</span>
        {commissionPct !== null ? (
          <span className="text-2xs text-muted-foreground tabular-nums">
            {commissionLabel} {formatPercentDisplay(commissionPct)}
          </span>
        ) : null}
      </div>

      <div className={cn('gap-3xs flex flex-col', items)}>
        <span className="text-2xs text-muted-foreground">{calculatedLabel}</span>
        <ProfitBadge
          value={netProfit}
          marginPct={marginPct}
          scale={scale}
          onOpen={onOpenBreakdown}
          showMarginPct
          emptyLabel={emptyLabel}
          className={self}
        />
      </div>

      {children}
    </div>
  );
}
