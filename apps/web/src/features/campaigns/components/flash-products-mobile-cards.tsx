'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ProductImageCell } from '@/components/patterns/product-image-cell';

import { useFlashReasonLabel } from '../hooks/use-flash-reason-label';
import type { FlashOfferKey, FlashProductRow } from '../lib/adapt-flash-product';
import {
  bandForKey,
  type FlashCustomChoice,
  type FlashCustomPriceMap,
  type FlashSelectionMap,
} from '../lib/flash-bulk-actions';
import { resolveBestChoice } from '../lib/best-choice';
import { FlashCurrentCell } from './flash-current-cell';
import { FlashCustomPriceCell } from './flash-custom-price-cell';
import { FlashProductOfferCell } from './flash-product-offer-cell';

const OFFER_KEYS = ['h24', 'h3'] as const satisfies readonly FlashOfferKey[];

export interface FlashProductsMobileCardsProps {
  rows: readonly FlashProductRow[];
  selection: FlashSelectionMap;
  customPrices: FlashCustomPriceMap;
  /** Live, uncommitted what-if profit per row — feeds only the "En kârlı" race. */
  customEstimates: Record<string, string | null>;
  onSelectOffer: (rowId: string, key: FlashOfferKey) => void;
  onSelectCustom: (rowId: string, choice: FlashCustomChoice) => void;
  onDeselectCustom: (rowId: string) => void;
  /** Reports a row's live what-if profit (or null when its input clears). */
  onCustomEstimate: (rowId: string, netProfit: string | null) => void;
  /** Reads a row's surviving uncommitted draft price (ref-backed; survives a filter unmount). */
  getCustomDraft: (rowId: string) => string | null | undefined;
  /** Persists a row's draft price so it survives the card unmounting. */
  onCustomDraftChange: (rowId: string, price: string | null) => void;
}

/**
 * Mobile layout: one card per offer row as a single TOP-TO-BOTTOM flow, so nothing competes
 * horizontally. Zones, each opened by a top divider rule (border-t) + gap-md:
 *   1. Product identity — image + title + meta + not-calculable reason.
 *   2. Current baseline — the shared {@link FlashCurrentCell}.
 *   3. Flash offers — one click-the-card offer per PRESENT offer (24 Saatlik / 3 Saatlik),
 *      each labelled with its slot name. An absent offer renders no zone (Berkin's
 *      column-hiding rule at card granularity).
 *   4. Custom price — a what-if input AND a selectable choice, stacked below.
 * The single "En kârlı" marker per card is resolved once (current vs an offer vs custom).
 * Shown below the `md` breakpoint; the desktop table is hidden there.
 */
export function FlashProductsMobileCards({
  rows,
  selection,
  customPrices,
  customEstimates,
  onSelectOffer,
  onSelectCustom,
  onDeselectCustom,
  onCustomEstimate,
  getCustomDraft,
  onCustomDraftChange,
}: FlashProductsMobileCardsProps): React.ReactElement {
  const t = useTranslations('flashProductsPage');
  const tSlot = useTranslations('flashProductsPage.slot');
  const reasonLabel = useFlashReasonLabel();

  return (
    <div className="gap-sm flex flex-col">
      {rows.map((row) => {
        const meta = [
          [row.category, row.brand].filter((v): v is string => v !== null).join(' · '),
          row.modelCode,
        ]
          .filter((v) => v !== null && v !== '')
          .join(' · ');
        // Whole-row winner (current vs an offer vs custom) → the single "En kârlı" marker.
        // The custom candidate is the LIVE what-if estimate when present, else the committed
        // custom price — so the badge follows the typed value pre-confirm.
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
                {!row.calculable && row.reason !== null ? (
                  <div className="text-warning text-2xs mt-3xs">{reasonLabel(row.reason)}</div>
                ) : null}
              </div>
            </div>

            {/* Zone 2: current baseline — same treatment as the offer blocks below, so the
                "do nothing" reference is directly comparable. */}
            <div className="border-border pt-md flex flex-col border-t">
              <span className="text-2xs text-muted-foreground mb-2xs font-medium">
                {t('table.displayPrice')}
              </span>
              <FlashCurrentCell row={row} isBest={best === 'current'} />
            </div>

            {/* Zone 3: one click-the-card offer per present offer, labelled with its slot. */}
            {OFFER_KEYS.map((key) => {
              const band = bandForKey(row, key);
              if (band === undefined) return null;
              return (
                <div key={key} className="border-border pt-md flex flex-col border-t">
                  <span className="text-2xs text-muted-foreground mb-2xs font-medium">
                    {tSlot(key)}
                  </span>
                  <FlashProductOfferCell
                    row={row}
                    band={band}
                    slotLabel={tSlot(key)}
                    isBest={best === band.key}
                    selected={selection[row.id] === band.key && customPrices[row.id] == null}
                    onSelect={() => onSelectOffer(row.id, key)}
                  />
                </div>
              );
            })}

            {/* Zone 4: custom price — a what-if AND a selectable choice. */}
            <div className="border-border pt-md border-t">
              <FlashCustomPriceCell
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
