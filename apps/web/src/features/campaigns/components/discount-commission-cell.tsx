'use client';

import { ArrowRight01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { InfoHint } from '@/components/patterns/info-hint';
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
  /** Detail-level tariff NAME feeding the band; surfaced in the `band` info hint. */
  tariffName: string | null;
  /** Detail-level tariff PERIOD label; surfaced in the `band` info hint. */
  periodLabel: string | null;
}

/**
 * The İndirimler detail commission cell — shared by the desktop table and the mobile cards so
 * both read identically. Shows the rate the DISCOUNTED scenario actually pays; when the current
 * scenario resolved to a different rate (a lower price can land in another commission band) it
 * renders the transition `current → discounted` with the pre-jump rate muted. A muted secondary
 * line names the source (tariff band / product / category). When the discounted scenario has no
 * resolved commission (not calculable / no commission) the whole cell collapses to a muted
 * em-dash. For a `band` source an {@link InfoHint} sits next to the source label, naming which
 * uploaded tariff FILE + period the rate came from (hover/focus on pointer devices; skipped on
 * touch, where the rate + source label still read on their own). Purely presentational — every
 * figure is backend-computed; this only renders.
 */
export function DiscountCommissionCell({
  current,
  discounted,
  tariffName,
  periodLabel,
}: DiscountCommissionCellProps): React.ReactElement {
  const t = useTranslations('discountsPage.commissionColumn');
  const source = discounted.commissionSource;

  // No resolved commission on the discounted scenario: collapse both lines to one muted dash.
  if (source === null) {
    return <span className="text-muted-foreground text-sm">{EM_DASH}</span>;
  }

  const sourceLabel: Record<DiscountCommissionSourceKey, string> = {
    band: t('source.band'),
    product: t('source.product'),
    category: t('source.category'),
  };

  const discountedRate = formatPercentDisplay(discounted.commissionPct);
  const currentRate =
    current.commissionPct !== null ? formatPercentDisplay(current.commissionPct) : null;
  // Only show the transition when the current scenario resolved to a rate that DISPLAYS
  // differently — a genuine band jump, not a sub-display-precision wobble.
  const showTransition = currentRate !== null && currentRate !== discountedRate;

  // A band rate resolves from one specific uploaded tariff week — name the file + period in an
  // info hint. Only when both are present (band always has them; the guard keeps the message whole).
  const tariffHint =
    source === 'band' &&
    tariffName !== null &&
    tariffName !== '' &&
    periodLabel !== null &&
    periodLabel !== ''
      ? {
          name: tariffName,
          message: t('tariffTooltip', { tariff: tariffName, period: periodLabel }),
        }
      : null;

  return (
    <div className="gap-3xs flex flex-col items-start">
      {showTransition ? (
        <span className="gap-3xs flex items-center text-sm tabular-nums">
          <span className="text-muted-foreground">{currentRate}</span>
          <ArrowRight01Icon className="text-muted-foreground size-3 shrink-0" aria-hidden />
          <span className="text-foreground font-medium">{discountedRate}</span>
        </span>
      ) : (
        <span className="text-foreground text-sm font-medium tabular-nums">{discountedRate}</span>
      )}
      <span className="gap-3xs text-2xs text-muted-foreground flex items-center">
        {sourceLabel[source]}
        {tariffHint !== null ? (
          <InfoHint label={tariffHint.name}>{tariffHint.message}</InfoHint>
        ) : null}
      </span>
    </div>
  );
}
