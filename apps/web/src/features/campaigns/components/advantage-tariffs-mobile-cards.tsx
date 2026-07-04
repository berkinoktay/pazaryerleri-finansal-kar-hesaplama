'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ProductImageCell } from '@/components/patterns/product-image-cell';

import { useAdvantageReasonLabel } from '../hooks/use-advantage-reason-label';
import {
  tierForKey,
  type AdvantageCustomChoice,
  type AdvantageCustomPriceMap,
  type AdvantageTierMap,
  type NonNullStarTierKey,
} from '../lib/advantage-bulk-actions';
import type { AdvantageTariffDetailItem } from '../types';
import { AdvantageCurrentCell } from './advantage-current-cell';
import { AdvantageCustomPriceCell } from './advantage-custom-price-cell';
import { AdvantageTierCell } from './advantage-tier-cell';

const TIER_KEYS = ['tier1', 'tier2', 'tier3'] as const satisfies readonly NonNullStarTierKey[];

export interface AdvantageTariffsMobileCardsProps {
  rows: readonly AdvantageTariffDetailItem[];
  tiers: AdvantageTierMap;
  customPrices: AdvantageCustomPriceMap;
  onSelectTier: (rowId: string, key: NonNullStarTierKey) => void;
  onSelectCustom: (rowId: string, choice: AdvantageCustomChoice) => void;
  onDeselectCustom: (rowId: string) => void;
}

/**
 * Mobile layout: one card per product as a single TOP-TO-BOTTOM flow, so nothing
 * competes horizontally. Zones, each opened by a top divider rule (border-t) + gap-md so
 * the flat sections read as distinct blocks:
 *   1. Product identity — image + title + meta + not-calculable reason.
 *   2. Current baseline — "Güncel fiyat" + baseline profit as label→value rows.
 *   3. Star tiers — one flat block per tier (Avantaj / Çok Avantaj / Süper Avantaj), each
 *      with its own select control.
 *   4. Custom price — a what-if input AND a selectable "Bu fiyatı seç" choice.
 * Every selectable option shares the one TariffSelectControl affordance. Shown below the
 * `md` breakpoint; the desktop table is hidden there.
 */
export function AdvantageTariffsMobileCards({
  rows,
  tiers,
  customPrices,
  onSelectTier,
  onSelectCustom,
  onDeselectCustom,
}: AdvantageTariffsMobileCardsProps): React.ReactElement {
  const t = useTranslations('productLabelsPage');
  const tTier = useTranslations('productLabelsPage.tier');
  const reasonLabel = useAdvantageReasonLabel();

  return (
    <div className="gap-sm flex flex-col">
      {rows.map((row) => {
        const meta = [
          [row.category, row.brand].filter((v): v is string => v !== null).join(' · '),
          row.stockCode,
        ]
          .filter((v) => v !== null && v !== '')
          .join(' · ');
        return (
          <div
            key={row.id}
            className="border-border bg-card gap-md p-md flex flex-col rounded-lg border"
          >
            {/* Zone 1: product identity — full width, no competing right column. */}
            <div className="gap-sm flex min-w-0 items-start">
              <ProductImageCell url={row.imageUrl} alt={row.productTitle} size="lg" />
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

            {/* Zone 2: current baseline — same price + commission + ProfitBadge treatment as
                the tier blocks below (via AdvantageCurrentCell), so the "do nothing" reference
                is directly comparable to each advantage tier. */}
            <div className="border-border pt-md flex flex-col border-t">
              <span className="text-2xs text-muted-foreground mb-2xs font-medium">
                {t('table.displayPrice')}
              </span>
              <AdvantageCurrentCell row={row} />
            </div>

            {/* Zone 3: one flat block per star tier, each with its own select control. */}
            {TIER_KEYS.map((key) => {
              const tier = tierForKey(row, key);
              if (tier === undefined) return null;
              return (
                <div key={key} className="border-border pt-md flex flex-col border-t">
                  <span className="text-2xs text-muted-foreground mb-2xs font-medium">
                    {tTier(key)}
                  </span>
                  <AdvantageTierCell
                    row={row}
                    tier={tier}
                    isBest={row.bestTierKey === key}
                    selected={tiers[row.id] === key}
                    onToggle={() => onSelectTier(row.id, key)}
                  />
                </div>
              );
            })}

            {/* Zone 4: custom price — a what-if AND a selectable choice. */}
            <div className="border-border pt-md border-t">
              <AdvantageCustomPriceCell
                row={row}
                isSelected={customPrices[row.id] != null}
                onSelect={(choice) => onSelectCustom(row.id, choice)}
                onDeselect={() => onDeselectCustom(row.id)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
