'use client';

import * as React from 'react';

import { ProductImageCell } from '@/components/patterns/product-image-cell';

import { resolveBestChoice } from '../lib/best-choice';
import type { CustomChoice, CustomPriceMap, SelectionMap } from '../lib/bulk-actions';
import type { CommissionTariffRow } from '../types';
import { CurrentPriceCell } from './current-price-cell';
import { CustomPriceCell } from './custom-price-cell';
import { PriceBandCell } from './price-band-cell';

const BAND_INDEXES = [0, 1, 2, 3] as const;

export interface CommissionTariffsMobileCardsProps {
  rows: readonly CommissionTariffRow[];
  selection: SelectionMap;
  customPrices: CustomPriceMap;
  /** Live, uncommitted what-if profit per row — feeds only the "En kârlı" race. */
  customEstimates: Record<string, string | null>;
  onSelectBand: (rowId: string, band: string) => void;
  onSelectCustom: (rowId: string, band: string, choice: CustomChoice) => void;
  onDeselectCustom: (rowId: string) => void;
  /** Reports a row's live what-if profit (or null when its input clears). */
  onCustomEstimate: (rowId: string, netProfit: string | null) => void;
  /** Reads a row's surviving uncommitted draft price (ref-backed; survives a filter/tab unmount). */
  getCustomDraft: (rowId: string) => string | null | undefined;
  /** Persists a row's draft price so it survives the card unmounting. */
  onCustomDraftChange: (rowId: string, price: string | null) => void;
}

/**
 * Mobile layout: one card per product as a top-to-bottom flow, its sections opened
 * by a top divider rule (border-t) + gap-md — the same treatment as the Plus tariff
 * card:
 *   1. Product identity — image + title + meta + not-calculable reason.
 *   2. Current baseline — the shared {@link CurrentPriceCell} (price the buyer sees +
 *      current commission + clickable profit badge).
 *   3. The four price bands in a 2×2 grid — each a click-the-card selectable option.
 *   4. Custom price — a what-if input AND a selectable choice, stacked below.
 * Shown below the `md` breakpoint; the desktop table is hidden there.
 */
export function CommissionTariffsMobileCards({
  rows,
  selection,
  customPrices,
  customEstimates,
  onSelectBand,
  onSelectCustom,
  onDeselectCustom,
  onCustomEstimate,
  getCustomDraft,
  onCustomDraftChange,
}: CommissionTariffsMobileCardsProps): React.ReactElement {
  return (
    <div className="gap-sm flex flex-col">
      {rows.map((row) => {
        const meta = [
          [row.category, row.brand].filter((v): v is string => v !== null).join(' · '),
          row.stockCode,
        ]
          .filter((v) => v !== null && v !== '')
          .join(' · ');
        // Whole-row winner (current vs bands vs custom) → the single "En kârlı" marker.
        // The custom candidate is the LIVE what-if estimate when present, else the
        // committed custom price — so the badge follows the typed value pre-confirm.
        const best = resolveBestChoice(
          row,
          customEstimates[row.id] ?? customPrices[row.id]?.netProfit ?? null,
        );
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
              </div>
            </div>

            {/* Zone 2: current baseline — the shared current cell, the "do nothing"
                reference every band + custom price is compared against. */}
            <div className="border-border pt-md border-t">
              <CurrentPriceCell row={row} isBest={best === 'current'} />
            </div>

            {/* Zone 3: the four price bands — a 2×2 grid of click-the-card choices. */}
            <div className="gap-md border-border pt-md grid grid-cols-2 border-t">
              {BAND_INDEXES.map((i) => {
                const band = row.bands[i];
                if (band === undefined) return null;
                return (
                  <PriceBandCell
                    key={band.key}
                    row={row}
                    band={band}
                    isBest={best === band.key}
                    // Only a PLAIN boundary choice lights a band; a custom price
                    // drives the derived band without highlighting it.
                    selected={selection[row.id] === band.key && customPrices[row.id] == null}
                    onSelect={(key) => onSelectBand(row.id, key)}
                  />
                );
              })}
            </div>

            {/* Zone 4: custom price — a what-if AND a selectable choice. */}
            <div className="border-border pt-md border-t">
              <CustomPriceCell
                row={row}
                isBest={best === 'custom'}
                isSelected={customPrices[row.id] != null}
                onSelect={(band, choice) => onSelectCustom(row.id, band, choice)}
                onDeselect={() => onDeselectCustom(row.id)}
                // Stable parent handler passed straight through (the cell now reports its
                // own rowId) — no per-row arrow that would restart the debounce each render.
                onEstimate={onCustomEstimate}
                committedPrice={customPrices[row.id]?.price ?? null}
                committedNetProfit={customPrices[row.id]?.netProfit ?? null}
                committedMarginPct={customPrices[row.id]?.marginPct ?? null}
                // Ref-backed draft store: keeps an uncommitted what-if price alive when a
                // filter / tab switch unmounts this card and later remounts it.
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
