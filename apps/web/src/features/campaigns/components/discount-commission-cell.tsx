'use client';

import { ArrowRight01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatPercentDisplay } from '@/lib/format-percent';

import type { DiscountCommissionBand, DiscountScenario } from '../lib/adapt-discount-list';
import { findBandByCommissionPct } from '../lib/commission-band-range';
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
  /** Detail-level tariff NAME feeding the band; shown in the bands popover footer. */
  tariffName: string | null;
  /** Detail-level tariff PERIOD label; shown in the bands popover footer. */
  periodLabel: string | null;
  /**
   * The item's commission-band ladder (top-down); null when no tariff week resolved bands
   * for the barcode. When present, the WHOLE cell becomes a single popover trigger that marks
   * which band the current + discounted prices land in and names the source tariff/period.
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
 * em-dash.
 *
 * ONE consolidated disclosure: for a `band` source with a ladder the ENTIRE cell (rate line +
 * source label) is a single click/keyboard popover trigger — a dotted underline under the source
 * label is the only affordance. The popover shows the band ranges with the current + discounted
 * prices marked, and a footer naming which uploaded tariff FILE + period the rate came from.
 * Non-band sources (product / category) are NOT interactive — plain rate + source label, no
 * underline, no popover. Purely presentational — every figure is backend-computed; this renders.
 */
export function DiscountCommissionCell({
  current,
  discounted,
  tariffName,
  periodLabel,
  commissionBands,
}: DiscountCommissionCellProps): React.ReactElement {
  const t = useTranslations('discountsPage.commissionColumn');
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

  // The rate line (transition or single rate) — identical whether or not the cell is interactive.
  const rateLine = showTransition ? (
    <span className="gap-3xs flex items-center text-sm tabular-nums">
      <span className="text-muted-foreground">{currentRate}</span>
      <ArrowRight01Icon className="text-muted-foreground size-3 shrink-0" aria-hidden />
      <span className="text-foreground font-medium">{discountedRate}</span>
    </span>
  ) : (
    <span className="text-foreground text-sm font-medium tabular-nums">{discountedRate}</span>
  );

  // The disclosure is band-only: the source must be `band` (product/category rates are NOT
  // interactive per the docstring) AND a ladder must exist to have ranges to show + prices to mark.
  const showBandsPopover =
    source === 'band' && commissionBands !== null && commissionBands.length > 0;

  // Non-band sources (product / category) have no ladder — a plain, non-interactive cell.
  if (!showBandsPopover) {
    return (
      <div className="gap-3xs flex flex-col items-start">
        {rateLine}
        <span className="text-2xs text-muted-foreground">{sourceLabel[source]}</span>
      </div>
    );
  }

  // Highlight ONLY the ACTIVE band — the one whose RATE the cell actually charges
  // (discounted.commissionPct, the "baz alınan" rate). Marking by the shown rate (not by the
  // discounted price) follows the band that drives it even for list-price-anchored discounts
  // (X-al-Y / Nth-product), where the rate comes from the CURRENT price's band while the
  // displayed price is the lower effective one. Gated on `source === 'band'`: only a band-
  // resolved rate may highlight a band row — a product/category rate that coincidentally
  // equals a band's pct must NOT mark. No money math.
  const activeBand =
    source === 'band' && discounted.commissionPct !== null
      ? findBandByCommissionPct(commissionBands, discounted.commissionPct)
      : null;
  const bandMarks: CommissionBandMark[] = activeBand !== null ? [{ band: activeBand }] : [];

  // Popover footer: which uploaded tariff FILE + period fed the band rate (band always carries
  // both; the guard keeps the footer whole and drops it if the detail lacks a resolved source).
  const footer =
    tariffName !== null && tariffName !== '' ? (
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-foreground font-medium">{tariffName}</span>
        {periodLabel !== null && periodLabel !== '' ? (
          <span className="text-2xs text-muted-foreground">{periodLabel}</span>
        ) : null}
      </div>
    ) : undefined;

  // The WHOLE cell is the single popover trigger — a real <button> (keyboard-reachable), with a
  // dotted underline under the source label as the only affordance. stopPropagation so opening
  // the disclosure never triggers an enclosing row action.
  return (
    <CommissionBandsPopover
      bands={commissionBands}
      labels={bandLabels}
      marks={bandMarks}
      footer={footer}
      trigger={
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="focus-visible:ring-ring gap-3xs flex cursor-pointer flex-col items-start rounded-sm text-left outline-none focus-visible:ring-2"
        >
          {rateLine}
          <span className="text-2xs text-muted-foreground underline decoration-dotted underline-offset-2">
            {sourceLabel[source]}
          </span>
        </button>
      }
    />
  );
}
