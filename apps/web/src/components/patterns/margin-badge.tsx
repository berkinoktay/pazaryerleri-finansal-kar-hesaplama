'use client';

import type Decimal from 'decimal.js';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Badge } from '@/components/ui/badge';
import { marginBadgeStyle } from '@/lib/margin-color-style';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { cn } from '@/lib/utils';

const EMPTY_VALUE = '—';

export interface MarginBadgeProps {
  /** Monetary amount. `null` renders a neutral em-dash badge. */
  value: Decimal | string | number | null;
  /** Row margin % (percent units, e.g. `'9.11'`) that drives the red→green fill. `null` → neutral. */
  marginPct: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Reusable margin-colored currency chip. The fill hue tracks `marginPct` on the
 * red→green scale the user configured in settings (read here from
 * `useMarginColoring`), so profitability reads at a glance and every surface
 * (orders, commission tariffs, …) shares one source of truth for the ramp.
 * Display-only — wrap it in a button when a click should open a detail view.
 *
 * @useWhen rendering a margin-colored profit/amount chip fed by the user's margin scale
 */
export function MarginBadge({
  value,
  marginPct,
  size = 'md',
  className,
}: MarginBadgeProps): React.ReactElement {
  const scale = useMarginColoring();
  // runtime-dynamic: margin-driven tinted fill/text/border (or undefined → neutral chip)
  const style = value === null ? undefined : marginBadgeStyle(marginPct, scale);

  return (
    <Badge
      tone="neutral"
      variant="surface"
      size={size}
      style={style}
      className={cn('tabular-nums', className)}
    >
      {value === null ? EMPTY_VALUE : <Currency value={value} />}
    </Badge>
  );
}
