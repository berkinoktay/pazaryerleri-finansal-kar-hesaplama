'use client';

import { ArrowRight01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatPercentDisplay } from '@/lib/format-percent';

import type { DiscountScenario } from '../lib/adapt-discount-list';

/** Em-dash rendered when the discounted scenario has no resolved commission. */
const EM_DASH = '—';

/** The three commission sources, as concrete keys for next-intl's typed `t`. */
type DiscountCommissionSourceKey = 'band' | 'product' | 'category';

export interface DiscountCommissionCellProps {
  /** Current-price scenario — supplies the pre-jump rate for the transition. */
  current: DiscountScenario;
  /** Discounted-price scenario — supplies the rate actually used + its source. */
  discounted: DiscountScenario;
  /** Detail-level tariff NAME feeding the band; shown as a hover tooltip for `band`. */
  tariffName: string | null;
  /** Detail-level tariff PERIOD label; appended to the band tooltip. */
  periodLabel: string | null;
}

/**
 * The İndirimler detail commission cell — shared by the desktop table and the mobile cards so
 * both read identically. Shows the rate the DISCOUNTED scenario actually pays; when the current
 * scenario resolved to a different rate (a lower price can land in another commission band) it
 * renders the transition `current → discounted` with the pre-jump rate muted. A muted secondary
 * line names the source (tariff band / product / category). When the discounted scenario has no
 * resolved commission (not calculable / no commission) the whole cell collapses to a muted
 * em-dash. For a `band` source the resolving tariff name + period surface as a hover tooltip.
 * Purely presentational — every figure is backend-computed; this only renders.
 */
export function DiscountCommissionCell({
  current,
  discounted,
  tariffName,
  periodLabel,
}: DiscountCommissionCellProps): React.ReactElement {
  const tSource = useTranslations('discountsPage.commissionColumn.source');
  const source = discounted.commissionSource;

  // No resolved commission on the discounted scenario: collapse both lines to one muted dash.
  if (source === null) {
    return <span className="text-muted-foreground text-sm">{EM_DASH}</span>;
  }

  const sourceLabel: Record<DiscountCommissionSourceKey, string> = {
    band: tSource('band'),
    product: tSource('product'),
    category: tSource('category'),
  };

  const discountedRate = formatPercentDisplay(discounted.commissionPct);
  const currentRate =
    current.commissionPct !== null ? formatPercentDisplay(current.commissionPct) : null;
  // Only show the transition when the current scenario resolved to a rate that DISPLAYS
  // differently — a genuine band jump, not a sub-display-precision wobble.
  const showTransition = currentRate !== null && currentRate !== discountedRate;

  // A band rate resolves from one specific tariff week — expose which one as a hover tooltip.
  const title =
    source === 'band' && tariffName !== null && tariffName !== ''
      ? periodLabel !== null && periodLabel !== ''
        ? `${tariffName} · ${periodLabel}`
        : tariffName
      : undefined;

  return (
    <div className="gap-3xs flex flex-col items-start" title={title}>
      {showTransition ? (
        <span className="gap-3xs flex items-center text-sm tabular-nums">
          <span className="text-muted-foreground">{currentRate}</span>
          <ArrowRight01Icon className="text-muted-foreground size-3 shrink-0" aria-hidden />
          <span className="text-foreground font-medium">{discountedRate}</span>
        </span>
      ) : (
        <span className="text-foreground text-sm font-medium tabular-nums">{discountedRate}</span>
      )}
      <span className="text-2xs text-muted-foreground">{sourceLabel[source]}</span>
    </div>
  );
}
