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
   * Reserved "En kârlı" slot. `{ label, visible, icon? }` renders a badge whose
   * VISIBILITY is `visible` but whose height is always reserved (keeps the price
   * aligned with the tier columns). `icon` overrides the leading glyph — every vertical
   * passes a Sparkles icon so its marker matches the band/offer/custom ribbons; the
   * {@link StarIcon} is only the fallback default. `null`/omitted → the slot is not
   * rendered at all, adding no height.
   */
  bestBadge?: { label: string; visible: boolean; icon?: React.ReactNode } | null;
  /**
   * Desktop min width of the cell. `band` (default) matches a full band card so the
   * Advantage columns line up; `current` is a touch narrower (no card frame around
   * the commission-current cell, so it needn't reserve the band card's padding).
   */
  minWidth?: 'band' | 'current';
  /** The caller's breakdown modal (Advantage vs commission use different ones). */
  children?: React.ReactNode;
}

const MIN_WIDTH_CLASS: Record<NonNullable<TariffCurrentCellProps['minWidth']>, string> = {
  band: 'md:min-w-tariff-band',
  current: 'md:min-w-tariff-current',
};

/**
 * Presentational shell for a campaign vertical's CURRENT baseline cell — the "do
 * nothing" reference the seller compares each option against: the price the buyer
 * currently pays (the hero), its current commission, and the calculated profit as
 * the SAME clickable {@link ProfitBadge} the other columns show (info icon, tooltip,
 * opens a breakdown modal). Purely presentational — the caller wires the data, the
 * estimate call, and the breakdown modal (passed as `children`).
 *
 * Shared by three verticals so their current cell reads identically — Advantage
 * ({@link AdvantageCurrentCell}), commission ({@link CurrentPriceCell}), and Plus
 * ({@link PlusCurrentPriceCell}). All are left-aligned and a touch narrower than a band
 * card (`minWidth="current"`), and each passes the Sparkles "En kârlı" badge only when
 * keeping the current price wins the row (no reserved slot, so a non-best current cell
 * adds no height).
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
  minWidth = 'band',
  children,
}: TariffCurrentCellProps): React.ReactElement {
  return (
    <div className={cn('gap-sm flex min-w-0 flex-col items-start', MIN_WIDTH_CLASS[minWidth])}>
      <div className="gap-3xs flex min-w-0 flex-col items-start">
        {/* Reserved "En kârlı" slot — invisible unless `bestBadge.visible`, but the
            reserved height keeps the price aligned with the tier columns' price rows.
            Omitted entirely when the vertical has no "best" concept. */}
        {bestBadge !== null ? (
          <Badge
            tone="primary"
            variant="solid"
            radius="full"
            leadingIcon={bestBadge.icon ?? <StarIcon />}
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

      <div className="gap-3xs flex flex-col items-start">
        <span className="text-2xs text-muted-foreground">{calculatedLabel}</span>
        <ProfitBadge
          value={netProfit}
          marginPct={marginPct}
          scale={scale}
          onOpen={onOpenBreakdown}
          showMarginPct
          emptyLabel={emptyLabel}
          className="self-start"
        />
      </div>

      {children}
    </div>
  );
}
