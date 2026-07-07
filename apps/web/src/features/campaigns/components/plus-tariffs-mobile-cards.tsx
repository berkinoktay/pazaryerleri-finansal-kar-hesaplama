'use client';

import * as React from 'react';

import { ProductImageCell } from '@/components/patterns/product-image-cell';

import { usePlusReasonLabel } from '../hooks/use-plus-reason-label';
import type { PlusTariffRow } from '../lib/adapt-plus-tariff';
import { resolveBestChoice } from '../lib/best-choice';
import type {
  PlusCustomChoice,
  PlusCustomPriceMap,
  PlusSelectionMap,
} from '../lib/plus-bulk-actions';
import { PlusBandCell } from './plus-band-cell';
import { PlusCurrentPriceCell } from './plus-current-price-cell';
import { PlusCustomPriceCell } from './plus-custom-price-cell';

export interface PlusTariffsMobileCardsProps {
  rows: readonly PlusTariffRow[];
  selection: PlusSelectionMap;
  customPrices: PlusCustomPriceMap;
  /** Live, uncommitted what-if profit per row — feeds only the "En kârlı" race. */
  customEstimates: Record<string, string | null>;
  onToggleJoin: (rowId: string) => void;
  onSelectCustom: (rowId: string, choice: PlusCustomChoice) => void;
  onDeselectCustom: (rowId: string) => void;
  /** Reports a row's live what-if profit (or null when its input clears). */
  onCustomEstimate: (rowId: string, netProfit: string | null) => void;
  /** Reads a row's surviving uncommitted draft price (ref-backed; survives a filter/tab unmount). */
  getCustomDraft: (rowId: string) => string | null | undefined;
  /** Persists a row's draft price so it survives the card unmounting. */
  onCustomDraftChange: (rowId: string, price: string | null) => void;
}

/**
 * Mobile layout: one card per product as a top-to-bottom flow, each section opened by a
 * top divider rule (border-t) + gap-md — the same treatment as the commission tariff
 * card:
 *   1. Product identity — image + title + meta + not-calculable reason.
 *   2. Current baseline — the shared {@link PlusCurrentPriceCell} (price the buyer sees +
 *      current commission + clickable profit badge).
 *   3. Plus offer — a click-the-card selectable option (join at the ceiling).
 *   4. Custom price — a what-if input AND a selectable choice, stacked below.
 * Shown below the `md` breakpoint; the desktop table is hidden there.
 */
export function PlusTariffsMobileCards({
  rows,
  selection,
  customPrices,
  customEstimates,
  onToggleJoin,
  onSelectCustom,
  onDeselectCustom,
  onCustomEstimate,
  getCustomDraft,
  onCustomDraftChange,
}: PlusTariffsMobileCardsProps): React.ReactElement {
  const reasonLabel = usePlusReasonLabel();

  return (
    <div className="gap-sm flex flex-col">
      {rows.map((row) => {
        const meta = [
          [row.category, row.brand].filter((v): v is string => v !== null).join(' · '),
          row.stockCode,
        ]
          .filter((v) => v !== null && v !== '')
          .join(' · ');
        // Whole-row winner (current vs offer vs custom) → the single "En kârlı" marker.
        // The custom candidate is the LIVE what-if estimate when present, else the
        // committed custom price — so the badge follows the typed value pre-confirm.
        const best = resolveBestChoice(
          row,
          customEstimates[row.id] ?? customPrices[row.id]?.netProfit ?? null,
        );
        const band = row.bands[0];
        return (
          <div
            key={row.id}
            className="border-border bg-card gap-md p-md flex flex-col rounded-lg border"
          >
            {/* Zone 1: product identity — full width, no competing right column. */}
            <div className="gap-sm flex min-w-0 items-start">
              <ProductImageCell url={row.imageUrl} alt={row.productTitle} size="xl" fit="contain" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium">{row.productTitle}</div>
                {meta !== '' ? (
                  <div className="text-2xs text-muted-foreground tabular-nums">{meta}</div>
                ) : null}
                {!row.calculable && row.reason !== null ? (
                  <div className="text-warning text-2xs mt-3xs">{reasonLabel(row.reason)}</div>
                ) : null}
              </div>
            </div>

            {/* Zone 2: current baseline — the shared current cell, the "do nothing"
                reference the Plus offer + custom price are compared against. */}
            <div className="border-border pt-md border-t">
              <PlusCurrentPriceCell row={row} isBest={best === 'current'} />
            </div>

            {/* Zone 3: the Plus offer — a click-the-card join choice. */}
            {band !== undefined ? (
              <div className="border-border pt-md border-t">
                <PlusBandCell
                  row={row}
                  band={band}
                  isBest={best === 'plus'}
                  // Only a PLAIN ceiling join lights the card; a custom price is the
                  // row's join instead.
                  selected={selection[row.id] === 'plus' && customPrices[row.id] == null}
                  onSelect={() => onToggleJoin(row.id)}
                />
              </div>
            ) : null}

            {/* Zone 4: custom price — a what-if AND a selectable choice. */}
            <div className="border-border pt-md border-t">
              <PlusCustomPriceCell
                row={row}
                isBest={best === 'custom'}
                isSelected={customPrices[row.id] != null}
                onSelect={(choice) => onSelectCustom(row.id, choice)}
                onDeselect={() => onDeselectCustom(row.id)}
                onEstimate={onCustomEstimate}
                committedPrice={customPrices[row.id]?.price ?? null}
                getDraft={getCustomDraft}
                onDraftChange={onCustomDraftChange}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
