'use client';

import { Decimal } from 'decimal.js';
import { ArrowRight01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { InfoHint } from '@/components/patterns/info-hint';
import { formatPercentDisplay } from '@/lib/format-percent';

import type { DiscountCommissionBand, DiscountScenario } from '../lib/adapt-discount-list';
import { findBandForPrice } from '../lib/commission-band-range';
import {
  CommissionBandsPopover,
  type CommissionBandMark,
  type CommissionBandsLabels,
} from './commission-bands-popover';

/** Em-dash rendered when the discounted scenario has no resolved commission. */
const EM_DASH = '—';

/** The three commission sources, as concrete keys for next-intl's typed `t`. */
type DiscountCommissionSourceKey = 'band' | 'product' | 'category';

/**
 * The Discounts vertical's band-range + popover-chrome templates, bound to
 * `discountsPage.commissionBands`. The ONE shared {@link CommissionBandsPopover} takes the
 * labels as props (same idiom the Advantage / Flash callers use), so no namespace is
 * hard-coded into it.
 */
function useDiscountCommissionBandLabels(): CommissionBandsLabels {
  const t = useTranslations('discountsPage.commissionBands');
  return {
    above: (price) => t('above', { price }),
    range: (lower, upper) => t('range', { lower, upper }),
    below: (price) => t('below', { price }),
    title: t('title'),
    hint: t('hint'),
  };
}

export interface DiscountCommissionCellProps {
  /** Current-price scenario — supplies the pre-jump rate for the transition. */
  current: DiscountScenario;
  /** Discounted-price scenario — supplies the rate actually used + its source. */
  discounted: DiscountScenario;
  /** Detail-level tariff NAME feeding the band; surfaced in the `band` info hint. */
  tariffName: string | null;
  /** Detail-level tariff PERIOD label; surfaced in the `band` info hint. */
  periodLabel: string | null;
  /**
   * The item's commission-band ladder (top-down); null when no tariff week resolved bands
   * for the barcode. When present, the rate line gains a bands popover that marks which band
   * the current + discounted prices land in.
   */
  commissionBands: readonly DiscountCommissionBand[] | null;
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
  commissionBands,
}: DiscountCommissionCellProps): React.ReactElement {
  const t = useTranslations('discountsPage.commissionColumn');
  const tBands = useTranslations('discountsPage.commissionBands');
  const bandLabels = useDiscountCommissionBandLabels();
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

  // The bands popover: shown only when a ladder exists (band-sourced items). It marks which
  // band the CURRENT price and the DISCOUNTED price each land in — pure comparison over the
  // 2dp DISPLAY prices already on the row (no money math; every figure is backend-computed).
  const showBandsPopover = commissionBands !== null && commissionBands.length > 0;
  const currentBand = showBandsPopover
    ? findBandForPrice(commissionBands, new Decimal(current.price))
    : null;
  const discountedBand = showBandsPopover
    ? findBandForPrice(commissionBands, new Decimal(discounted.price))
    : null;
  const bandMarks: CommissionBandMark[] = [];
  if (currentBand !== null) {
    bandMarks.push({ band: currentBand, label: tBands('currentMark'), tone: 'neutral' });
  }
  if (discountedBand !== null) {
    bandMarks.push({ band: discountedBand, label: tBands('discountedMark'), tone: 'primary' });
  }

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
      {/* Rate line — the transition (or single rate) plus, when a ladder exists, the bands
          popover trigger (the same ⓘ affordance the Flash/Advantage cells use). */}
      <span className="gap-3xs flex items-center">
        {showTransition ? (
          <span className="gap-3xs flex items-center text-sm tabular-nums">
            <span className="text-muted-foreground">{currentRate}</span>
            <ArrowRight01Icon className="text-muted-foreground size-3 shrink-0" aria-hidden />
            <span className="text-foreground font-medium">{discountedRate}</span>
          </span>
        ) : (
          <span className="text-foreground text-sm font-medium tabular-nums">{discountedRate}</span>
        )}
        {showBandsPopover ? (
          <CommissionBandsPopover bands={commissionBands} labels={bandLabels} marks={bandMarks} />
        ) : null}
      </span>
      <span className="gap-3xs text-2xs text-muted-foreground flex items-center">
        {sourceLabel[source]}
        {tariffHint !== null ? (
          <InfoHint label={tariffHint.name}>{tariffHint.message}</InfoHint>
        ) : null}
      </span>
    </div>
  );
}
