'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { ProductImageCell } from '@/components/patterns/product-image-cell';
import { formatPercentDisplay } from '@/lib/format-percent';

import { useReasonLabel } from '../hooks/use-reason-label';
import type { SelectionMap } from '../lib/bulk-actions';
import type { CommissionTariffRow } from '../types';
import { CustomPriceCell } from './custom-price-cell';
import { PriceBandCell } from './price-band-cell';

const BAND_INDEXES = [0, 1, 2, 3] as const;

export interface CommissionTariffsMobileCardsProps {
  rows: readonly CommissionTariffRow[];
  selection: SelectionMap;
  onSelectBand: (rowId: string, band: string) => void;
}

/**
 * Mobile layout: each product is a card with its 4 bands in a 2×2 grid, so there
 * is no horizontal scroll and every band is a large tap target. Shown below the
 * `md` breakpoint; the desktop table is hidden there.
 */
export function CommissionTariffsMobileCards({
  rows,
  selection,
  onSelectBand,
}: CommissionTariffsMobileCardsProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const reasonLabel = useReasonLabel();

  return (
    <div className="gap-sm flex flex-col">
      {rows.map((row) => {
        const categoryBrand = [row.category, row.brand]
          .filter((v): v is string => v !== null)
          .join(' · ');
        return (
          <div
            key={row.id}
            className="border-border bg-card gap-sm p-md flex flex-col rounded-lg border"
          >
            <div className="gap-sm flex items-start justify-between">
              <div className="gap-sm flex min-w-0 items-start">
                <ProductImageCell url={row.imageUrl} alt={row.productTitle} size="lg" />
                <div className="min-w-0">
                  <div className="line-clamp-2 text-sm font-medium">{row.productTitle}</div>
                  <div className="text-2xs text-muted-foreground tabular-nums">
                    {[categoryBrand, row.stockCode]
                      .filter((v) => v !== null && v !== '')
                      .join(' · ')}
                  </div>
                  {!row.calculable && row.reason !== null ? (
                    <div className="text-warning text-2xs">{reasonLabel(row.reason)}</div>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums">
                  <Currency value={row.currentPrice} />
                </div>
                <div className="text-2xs text-muted-foreground tabular-nums">
                  {formatPercentDisplay(row.currentCommissionPct)} {t('table.commission')}
                </div>
              </div>
            </div>
            {/* gap-y-md (not 2xs) leaves room for the "En iyi" ribbon that pokes
                above each band card's top edge, so a bottom-row ribbon never
                collides with the card above it. */}
            <div className="gap-x-2xs gap-y-md grid grid-cols-2">
              {BAND_INDEXES.map((i) => {
                const band = row.bands[i];
                if (band === undefined) return null;
                return (
                  <PriceBandCell
                    key={band.key}
                    row={row}
                    band={band}
                    isBest={row.bestBandKey === band.key}
                    selected={selection[row.id] === band.key}
                    onSelect={(key) => onSelectBand(row.id, key)}
                  />
                );
              })}
            </div>
            <CustomPriceCell row={row} />
          </div>
        );
      })}
    </div>
  );
}
