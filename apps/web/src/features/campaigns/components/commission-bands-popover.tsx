'use client';

import { InformationCircleIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatPercentDisplay } from '@/lib/format-percent';

import type { AdvantageCommissionBand } from '../api/get-advantage-tariff-detail.api';
import { formatBandRange, type BandRangeLabelFns } from '../lib/commission-band-range';

/**
 * The three band-range i18n templates bound to next-intl's `t`, so the inline
 * derived-band line (advantage-custom-price-cell) and the popover ladder below format
 * bands with the SAME wording. Shared here to keep the templates in one place. Not
 * memoised: the object is only read during render (never a hook dependency), so a
 * fresh reference each render is harmless.
 */
export function useCommissionBandLabels(): BandRangeLabelFns {
  const t = useTranslations('productLabelsPage.commissionBands');
  return {
    above: (price) => t('above', { price }),
    range: (lower, upper) => t('range', { lower, upper }),
    below: (price) => t('below', { price }),
  };
}

export interface CommissionBandsPopoverProps {
  /** The product's commission-band ladder (top-down). Non-empty by construction of the caller. */
  bands: readonly AdvantageCommissionBand[];
  /** Shared band-range label templates (from {@link useCommissionBandLabels}). */
  labels: BandRangeLabelFns;
}

/**
 * A small ⓘ button that opens a click Popover listing the product's commission bands —
 * each band's price window ("₺146,00 ve altı") with its commission ("%6,50"). This is
 * the PazarSync equivalent of Trendyol's "Ürün Komisyon Teklifleri" popup: it lets the
 * seller tell the STAR-TIER thresholds apart from the COMMISSION-BAND boundaries, which
 * are two different ladders that happen to sit near each other.
 *
 * Composed from the shared {@link Popover} primitive (click-triggered, portaled, closes
 * on outside click / Escape) — a click Popover, not a hover Tooltip, because the content
 * is a scannable list that must stay reachable on touch. The trigger is a real
 * `<button>` (keyboard + screen-reader reachable) and stops click propagation so opening
 * the hint never triggers an enclosing card / row action.
 */
export function CommissionBandsPopover({
  bands,
  labels,
}: CommissionBandsPopoverProps): React.ReactElement {
  const t = useTranslations('productLabelsPage.commissionBands');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('hint')}
          onClick={(event) => event.stopPropagation()}
          className="text-muted-foreground-dim hover:text-muted-foreground focus-visible:ring-ring duration-fast ease-out-quart inline-flex shrink-0 cursor-pointer items-center rounded-full align-middle transition-colors outline-none focus-visible:ring-2"
        >
          <InformationCircleIcon className="size-icon-xs" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto min-w-56">
        <span className="text-foreground mb-xs block text-xs font-semibold">{t('title')}</span>
        <ul className="gap-2xs flex flex-col">
          {bands.map((band) => {
            const range = formatBandRange(band, formatCurrency, labels);
            if (range === null) return null;
            return (
              <li
                key={`${band.lowerLimit ?? '∞'}-${band.upperLimit ?? '∞'}-${band.commissionPct}`}
                className="gap-x-md text-2xs flex items-baseline justify-between tabular-nums"
              >
                <span className="text-foreground">{range}</span>
                <span className="text-muted-foreground shrink-0">
                  {formatPercentDisplay(band.commissionPct)}
                </span>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
