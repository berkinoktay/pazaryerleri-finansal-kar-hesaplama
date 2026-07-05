'use client';

import * as React from 'react';

import { ProfitBadge } from '@/components/patterns/profit-badge';
import { type MarginScale } from '@/lib/margin-coloring';

import { ProfitDelta } from './profit-delta';

export interface TariffProfitBlockProps {
  /** Backend-computed net profit for this option (band boundary or custom estimate). */
  netProfit: string | null;
  /** Row margin % that tints the badge; `null` → neutral. */
  marginPct: string | null;
  /** Current-scenario net profit — the "do nothing" baseline for the delta. */
  currentNetProfit: string | null;
  scale: MarginScale | null;
  onOpenBreakdown: () => void;
  /** What the badge shows when `netProfit` is null (e.g. "Maliyet girin"); else "—". */
  emptyLabel?: React.ReactNode;
  /** "Hesaplanan kâr" — localized by the caller. */
  calculatedLabel: string;
  /** "Güncele göre" — localized by the caller. */
  vsCurrentLabel: string;
}

/**
 * The "Hesaplanan kâr" label + the colour-filled {@link ProfitBadge} (amount bold,
 * margin % smaller/lighter) + the "Güncele göre ±₺X" {@link ProfitDelta} — byte-for-
 * byte identical across every priced option (the band cards and the custom-price
 * card), so it lives here once. The badge is raised (`relative z-10`) above the
 * bands' select overlay; the card's `isolate` (see {@link TariffOptionCard}) keeps
 * that z-index local.
 */
export function TariffProfitBlock({
  netProfit,
  marginPct,
  currentNetProfit,
  scale,
  onOpenBreakdown,
  emptyLabel,
  calculatedLabel,
  vsCurrentLabel,
}: TariffProfitBlockProps): React.ReactElement {
  return (
    <div className="gap-3xs flex flex-col items-start">
      <span className="text-2xs text-muted-foreground">{calculatedLabel}</span>
      <ProfitBadge
        value={netProfit}
        marginPct={marginPct}
        scale={scale}
        onOpen={onOpenBreakdown}
        showMarginPct
        emptyLabel={emptyLabel}
        className="relative z-10 self-start"
      />
      <ProfitDelta
        optionNetProfit={netProfit}
        currentNetProfit={currentNetProfit}
        label={vsCurrentLabel}
      />
    </div>
  );
}
