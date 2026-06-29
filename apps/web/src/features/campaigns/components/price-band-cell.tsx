'use client';

import { useFormatter } from 'next-intl';
import * as React from 'react';

import { MarginBadge } from '@/components/patterns/margin-badge';
import { cn } from '@/lib/utils';

import type { BandKey, PriceBand } from '../types';

export interface PriceBandCellProps {
  band: PriceBand;
  /** Whether the seller has chosen this band for the product. */
  selected: boolean;
  /** Whether this is the most profitable band (highlight + label, not color alone). */
  isBest?: boolean;
  /** Localized "best band" label shown when `isBest` — a non-color cue for a11y. */
  bestLabel?: string;
  /** Whether this band is the product's current valid range (Trendyol's "Geçerli aralık"). */
  isCurrent?: boolean;
  /** Localized "current range" label shown when `isCurrent`. */
  currentLabel?: string;
  onSelect: (key: BandKey) => void;
}

/**
 * One price band as a selectable cell: its threshold, commission rate, and a
 * margin-colored profit chip ({@link MarginBadge}, fed by the user's settings
 * scale) answering "if I join this band, what do I earn?". Acts as a radio
 * within the product's band group (one band per product).
 */
export function PriceBandCell({
  band,
  selected,
  isBest = false,
  bestLabel,
  isCurrent = false,
  currentLabel,
  onSelect,
}: PriceBandCellProps): React.ReactElement {
  const format = useFormatter();

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(band.key)}
      className={cn(
        'gap-3xs p-xs flex w-full flex-col rounded-md border text-left',
        'duration-fast ease-out-quart transition-colors',
        'pointer-coarse:min-h-11',
        'focus-visible:shadow-focus focus-visible:outline-none',
        selected
          ? 'border-primary bg-accent'
          : isBest
            ? 'border-success bg-success-surface'
            : 'border-border hover:bg-muted',
      )}
    >
      <span className="gap-3xs flex items-center justify-between">
        <span className="text-2xs text-muted-foreground truncate">{band.thresholdLabel}</span>
        {isBest && bestLabel !== undefined ? (
          <span className="text-2xs text-success shrink-0 font-semibold">{bestLabel}</span>
        ) : isCurrent && currentLabel !== undefined ? (
          <span className="text-2xs text-muted-foreground shrink-0 font-medium">
            {currentLabel}
          </span>
        ) : null}
      </span>
      <span className="text-sm font-semibold tabular-nums">
        {format.number(band.commissionPct.toNumber(), 'percent')}
      </span>
      <MarginBadge value={band.profit} marginPct={band.marginPct} size="sm" />
    </button>
  );
}
