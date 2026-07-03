'use client';

import { Decimal } from 'decimal.js';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { cn } from '@/lib/utils';

export interface ProfitDeltaProps {
  /** The option's net profit (the Plus/band scenario, or the custom-price estimate). */
  optionNetProfit: string | null;
  /** The current-scenario net profit — the "do nothing" baseline to compare against. */
  currentNetProfit: string | null;
  /** The "vs current" prefix, localized by the caller (e.g. "Güncele göre"). */
  label: string;
  className?: string;
}

/**
 * "Güncele göre +₺124,10" — how much MORE (or less) profit this option nets than
 * doing nothing (the seller's current price/commission). Signed + color-coded so the
 * "is this worth choosing?" question reads in one glance; the +/− sign carries the
 * direction for color-blind users (never color alone). Renders nothing when either
 * side is uncalculable or the two are equal.
 *
 * This is display math on two ALREADY-backend-computed profits (exactly like the
 * header summary's sums) — it does not compute profit/commission/VAT itself, so the
 * no-frontend-financial-calculation rule holds.
 */
export function ProfitDelta({
  optionNetProfit,
  currentNetProfit,
  label,
  className,
}: ProfitDeltaProps): React.ReactElement | null {
  if (optionNetProfit === null || currentNetProfit === null) return null;
  const delta = new Decimal(optionNetProfit).sub(currentNetProfit);
  if (delta.isZero()) return null;
  const positive = delta.isPositive();
  return (
    <span
      className={cn(
        'text-2xs font-medium tabular-nums',
        positive ? 'text-success' : 'text-destructive',
        className,
      )}
    >
      {label} {positive ? '+' : '−'}
      {formatCurrency(delta.abs())}
    </span>
  );
}
