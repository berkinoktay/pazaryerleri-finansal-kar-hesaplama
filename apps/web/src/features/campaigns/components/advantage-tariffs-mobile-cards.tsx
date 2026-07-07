'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ProductImageCell } from '@/components/patterns/product-image-cell';

import type { AdvantageTariffRow, NonNullStarTierKey } from '../lib/adapt-advantage-tariff';
import {
  bandForKey,
  type AdvantageCustomChoice,
  type AdvantageCustomPriceMap,
  type AdvantageSelectionMap,
} from '../lib/advantage-bulk-actions';
import { resolveBestChoice } from '../lib/best-choice';
import { AdvantageCurrentCell } from './advantage-current-cell';
import { AdvantageCustomPriceCell } from './advantage-custom-price-cell';
import { AdvantageTierCell } from './advantage-tier-cell';

const TIER_KEYS = ['tier1', 'tier2', 'tier3'] as const satisfies readonly NonNullStarTierKey[];

export interface AdvantageTariffsMobileCardsProps {
  rows: readonly AdvantageTariffRow[];
  selection: AdvantageSelectionMap;
  customPrices: AdvantageCustomPriceMap;
  /** Live, uncommitted what-if profit per row — feeds only the "En kârlı" race. */
  customEstimates: Record<string, string | null>;
  onSelectTier: (rowId: string, key: NonNullStarTierKey) => void;
  onSelectCustom: (rowId: string, choice: AdvantageCustomChoice) => void;
  onDeselectCustom: (rowId: string) => void;
  /** Reports a row's live what-if profit (or null when its input clears). */
  onCustomEstimate: (rowId: string, netProfit: string | null) => void;
  /** Reads a row's surviving uncommitted draft price (ref-backed; survives a filter unmount). */
  getCustomDraft: (rowId: string) => string | null | undefined;
  /** Persists a row's draft price so it survives the card unmounting. */
  onCustomDraftChange: (rowId: string, price: string | null) => void;
}

/**
 * Mobile layout: one card per product as a single TOP-TO-BOTTOM flow, so nothing competes
 * horizontally. Zones, each opened by a top divider rule (border-t) + gap-md so the flat
 * sections read as distinct blocks:
 *   1. Product identity — image + title + meta + not-calculable reason.
 *   2. Current baseline — the shared {@link AdvantageCurrentCell} (price the buyer sees +
 *      current commission + clickable profit badge).
 *   3. Star tiers — one click-the-card tier per present tier (Avantaj / Çok Avantaj / Süper
 *      Avantaj), each labelled with its tier name (the desktop column header's stand-in).
 *   4. Custom price — a what-if input AND a selectable choice, stacked below.
 * The single "En kârlı" marker per card is resolved once (current vs a tier vs custom).
 * Shown below the `md` breakpoint; the desktop table is hidden there.
 */
export function AdvantageTariffsMobileCards({
  rows,
  selection,
  customPrices,
  customEstimates,
  onSelectTier,
  onSelectCustom,
  onDeselectCustom,
  onCustomEstimate,
  getCustomDraft,
  onCustomDraftChange,
}: AdvantageTariffsMobileCardsProps): React.ReactElement {
  const t = useTranslations('productLabelsPage');
  const tTier = useTranslations('productLabelsPage.tier');

  return (
    <div className="gap-sm flex flex-col">
      {rows.map((row) => {
        const meta = [
          [row.category, row.brand].filter((v): v is string => v !== null).join(' · '),
          row.stockCode,
        ]
          .filter((v) => v !== null && v !== '')
          .join(' · ');
        // Whole-row winner (current vs a tier vs custom) → the single "En kârlı" marker. The
        // custom candidate is the LIVE what-if estimate when present, else the committed
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
              </div>
            </div>

            {/* Zone 2: current baseline — same price + commission + ProfitBadge treatment as
                the tier blocks below, so the "do nothing" reference is directly comparable. */}
            <div className="border-border pt-md flex flex-col border-t">
              <span className="text-2xs text-muted-foreground mb-2xs font-medium">
                {t('table.displayPrice')}
              </span>
              <AdvantageCurrentCell row={row} isBest={best === 'current'} />
            </div>

            {/* Zone 3: one click-the-card tier per present tier, labelled with its name. */}
            {TIER_KEYS.map((key) => {
              const band = bandForKey(row, key);
              if (band === undefined) return null;
              return (
                <div key={key} className="border-border pt-md flex flex-col border-t">
                  <span className="text-2xs text-muted-foreground mb-2xs font-medium">
                    {tTier(key)}
                  </span>
                  <AdvantageTierCell
                    row={row}
                    band={band}
                    isBest={best === band.key}
                    selected={selection[row.id] === band.key && customPrices[row.id] == null}
                    onSelect={() => onSelectTier(row.id, key)}
                  />
                </div>
              );
            })}

            {/* Zone 4: custom price — a what-if AND a selectable choice. */}
            <div className="border-border pt-md border-t">
              <AdvantageCustomPriceCell
                row={row}
                isBest={best === 'custom'}
                isSelected={customPrices[row.id] != null}
                onSelect={(choice) => onSelectCustom(row.id, choice)}
                onDeselect={() => onDeselectCustom(row.id)}
                onEstimate={onCustomEstimate}
                committedPrice={customPrices[row.id]?.price ?? null}
                committedNetProfit={customPrices[row.id]?.netProfit ?? null}
                committedMarginPct={customPrices[row.id]?.marginPct ?? null}
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
