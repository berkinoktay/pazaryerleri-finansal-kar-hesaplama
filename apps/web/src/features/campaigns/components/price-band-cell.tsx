'use client';

import { useFormatter } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Badge } from '@/components/ui/badge';
import { marginBadgeStyle } from '@/lib/margin-color-style';
import { useMarginColoring } from '@/lib/margin-coloring-context';
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
  onSelect: (key: BandKey) => void;
}

/**
 * One price band as a selectable cell: its threshold, commission rate, and a
 * margin-colored profit chip answering "if I join this band, what do I earn?".
 * Acts as a radio within the product's band group (one band per product).
 */
export function PriceBandCell({
  band,
  selected,
  isBest = false,
  bestLabel,
  onSelect,
}: PriceBandCellProps): React.ReactElement {
  const format = useFormatter();
  const scale = useMarginColoring();
  // runtime-dynamic: margin-driven tinted fill/text/border on the profit chip
  const profitStyle = marginBadgeStyle(band.marginPct, scale);

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
        ) : null}
      </span>
      <span className="text-sm font-semibold tabular-nums">
        {format.number(band.commissionPct.toNumber(), 'percent')}
      </span>
      <Badge
        tone="neutral"
        variant="surface"
        size="sm"
        style={profitStyle}
        className="tabular-nums"
      >
        <Currency value={band.profit} />
      </Badge>
    </button>
  );
}
