'use client';

import * as React from 'react';

import { ProfitBadge } from '@/components/patterns/profit-badge';
import { Skeleton } from '@/components/ui/skeleton';
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
  /**
   * A price is in the input but its profit is still being computed (the debounced
   * estimate has not returned yet, and no committed figure seeds it). Render a
   * ProfitBadge-sized skeleton pill in the badge's slot instead of a mute "—", so the
   * card reads as "loading", not "no data". The label + delta rows keep their slots so
   * the swap to the real badge never shifts the card. Defaults to false — the band /
   * tier / offer cards always know their profit up front and never pass it.
   */
  loading?: boolean;
  /** Translated "loading" name for the skeleton pill's aria-busy status (used when `loading`). */
  loadingLabel?: string;
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
  loading = false,
  loadingLabel,
}: TariffProfitBlockProps): React.ReactElement {
  return (
    <div className="gap-3xs flex flex-col items-start">
      <span className="text-2xs text-muted-foreground">{calculatedLabel}</span>
      {loading ? (
        // The estimate is still on the way — a rounded pill the exact height of the md
        // Badge (18px line + 2×2px pad + 2×1px border = 24px = h-6) holds the badge's slot
        // so nothing shifts when the real figure lands.
        <Skeleton radius="full" label={loadingLabel} className="h-6 w-28" />
      ) : (
        <ProfitBadge
          value={netProfit}
          marginPct={marginPct}
          scale={scale}
          onOpen={onOpenBreakdown}
          showMarginPct
          emptyLabel={emptyLabel}
          className="relative z-10 self-start"
        />
      )}
      <ProfitDelta
        optionNetProfit={netProfit}
        currentNetProfit={currentNetProfit}
        label={vsCurrentLabel}
      />
    </div>
  );
}
