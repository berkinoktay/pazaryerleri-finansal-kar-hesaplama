'use client';

import { InformationCircleIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatPercentDisplay } from '@/lib/format-percent';
import { cn } from '@/lib/utils';

import type { AdvantageCommissionBand } from '../api/get-advantage-tariff-detail.api';
import { formatBandRange, type BandRangeLabelFns } from '../lib/commission-band-range';

/**
 * The band-range templates PLUS the popover's own chrome copy (title + trigger `hint`),
 * all bound to next-intl's `t`, so the inline derived-band line and the popover ladder
 * read from ONE labels object. Passed in by the caller (the ExportTariffDialog
 * labels-as-props pattern) so the ONE popover serves both the Advantage vertical
 * (`productLabelsPage.commissionBands`) and the Flash vertical
 * (`flashProductsPage.commissionBands`) without a hard-coded namespace.
 */
export interface CommissionBandsLabels extends BandRangeLabelFns {
  /** Popover heading, e.g. "Ürün komisyon teklifleri". */
  title: string;
  /** Trigger button accessible name, e.g. "Komisyon bantlarını göster". */
  hint: string;
}

/**
 * The Advantage vertical's band-range + popover-chrome templates, bound to
 * `productLabelsPage.commissionBands`. Not memoised: the object is only read during
 * render (never a hook dependency), so a fresh reference each render is harmless. The
 * Flash vertical has its own equivalent hook against its namespace.
 */
export function useCommissionBandLabels(): CommissionBandsLabels {
  const t = useTranslations('productLabelsPage.commissionBands');
  return {
    above: (price) => t('above', { price }),
    range: (lower, upper) => t('range', { lower, upper }),
    below: (price) => t('below', { price }),
    title: t('title'),
    hint: t('hint'),
  };
}

/**
 * A per-band marker: the band the seller's ACTIVE price lands in. `band` MUST be a reference to
 * one of the {@link CommissionBandsPopoverProps.bands} elements (identity match). The band a mark
 * points to gets a solid primary full-row highlight — the fill alone marks it, no label. Optional
 * feature: sibling verticals that pass no `marks` render exactly as before.
 */
export interface CommissionBandMark {
  /** The band this mark highlights — a reference-identical element of the `bands` array. */
  band: AdvantageCommissionBand;
}

export interface CommissionBandsPopoverProps {
  /** The product's commission-band ladder (top-down). Non-empty by construction of the caller. */
  bands: readonly AdvantageCommissionBand[];
  /** Shared band-range + popover-chrome labels (from the caller's per-namespace hook). */
  labels: CommissionBandsLabels;
  /**
   * Optional per-band markers. Each mark's `band` is matched by reference against the rendered
   * `bands`; the matching row gets a solid primary full-row highlight. Omitted by the
   * Advantage/Flash callers → no highlight, unchanged behaviour.
   */
  marks?: readonly CommissionBandMark[];
  /**
   * Optional custom trigger. When provided it REPLACES the default ⓘ icon button — rendered
   * via PopoverTrigger `asChild`, so it MUST be a single focusable element (a `<button>`). The
   * Discounts cell passes the whole commission cell here so the entire cell is the disclosure
   * target; the Advantage/Flash callers omit it → the default ⓘ button.
   */
  trigger?: React.ReactNode;
  /**
   * Optional footer node below the band list, set off by a top divider (e.g. the Discounts
   * vertical's source tariff name + period). Omitted by the Advantage/Flash callers → no footer.
   */
  footer?: React.ReactNode;
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
  marks,
  trigger,
  footer,
}: CommissionBandsPopoverProps): React.ReactElement {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={labels.hint}
            onClick={(event) => event.stopPropagation()}
            className="text-muted-foreground-dim hover:text-muted-foreground focus-visible:ring-ring duration-fast ease-out-quart inline-flex shrink-0 cursor-pointer items-center rounded-full align-middle transition-colors outline-none focus-visible:ring-2"
          >
            <InformationCircleIcon className="size-icon-xs" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="px-lg w-auto min-w-56">
        <span className="text-foreground mb-sm block text-xs font-semibold">{labels.title}</span>
        <ul className="gap-2xs flex flex-col">
          {bands.map((band) => {
            const range = formatBandRange(band, formatCurrency, labels);
            if (range === null) return null;
            // Reference-identity match: does the marked (active) price land in THIS band?
            const highlighted = marks?.some((mark) => mark.band === band) ?? false;
            return (
              <li
                key={`${band.lowerLimit ?? '∞'}-${band.upperLimit ?? '∞'}-${band.commissionPct}`}
                className={cn(
                  // Every row carries the same `px-sm` so the range/percent columns stay aligned
                  // whether or not the row is highlighted.
                  'gap-x-md text-2xs px-sm flex items-center justify-between tabular-nums',
                  // Active band: a solid primary fill (primary / primary-foreground are both
                  // dual-mode), INSET within the popover's `px-lg` gutter — the fill must not
                  // touch the popover edges. On the solid fill ALL text is
                  // `text-primary-foreground` (never muted on solid primary).
                  highlighted && 'bg-primary text-primary-foreground py-2xs rounded-sm',
                )}
              >
                <span className={highlighted ? undefined : 'text-foreground'}>{range}</span>
                <span className={cn('shrink-0', !highlighted && 'text-muted-foreground')}>
                  {formatPercentDisplay(band.commissionPct)}
                </span>
              </li>
            );
          })}
        </ul>
        {footer !== undefined && footer !== null ? (
          <div className="border-border mt-sm pt-sm border-t">{footer}</div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
