'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface TariffOptionCardProps {
  /** The seller's active choice → brand border + soft brand fill + ring. */
  selected: boolean;
  /**
   * Click-the-card behaviour (the four preset bands): adds cursor + hover so the
   * whole card reads as one big select target. Off for the custom-price card, whose
   * input rules out a card overlay (it commits via an explicit foot button instead).
   */
  interactive?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * The ONE shell every priced option in a commission-tariff row wears — the four
 * preset {@link PriceBandCell} bands AND the {@link CustomPriceCell} — so the row
 * reads as a single uniform set: same border, padding, radius, background, equal
 * height, and the same brand fill + ring when chosen. Extracting it here means the
 * card's look lives in one place (no drift, e.g. one card ending up a different
 * background than its neighbours).
 *
 * Always `relative isolate`: `relative` anchors the bands' stretched-overlay button;
 * `isolate` scopes the ProfitBadge's `z-10` to the card so it can never paint over
 * the sticky pinned product column during horizontal scroll.
 */
export function TariffOptionCard({
  selected,
  interactive = false,
  className,
  children,
}: TariffOptionCardProps): React.ReactElement {
  return (
    <div
      className={cn(
        'gap-xs px-sm py-md md:min-w-tariff-band duration-fast ease-out-quart bg-card relative isolate flex h-full w-full min-w-0 flex-col items-start rounded-md border transition-colors',
        // No hover state on any card (Berkin: the bg shift was distracting); the
        // click affordance is carried by the overlay's cursor-pointer instead.
        interactive && 'cursor-pointer',
        selected
          ? 'border-primary bg-primary-soft ring-primary ring-1 ring-inset'
          : 'border-border',
        className,
      )}
    >
      {children}
    </div>
  );
}
