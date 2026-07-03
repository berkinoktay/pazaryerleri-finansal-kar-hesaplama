'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { ProductImageCell } from '@/components/patterns/product-image-cell';
import { formatPercentDisplay } from '@/lib/format-percent';

import { usePlusReasonLabel } from '../hooks/use-plus-reason-label';
import type { PlusSelectionMap } from '../lib/plus-bulk-actions';
import type { PlusTariffDetailItem } from '../types';
import { PlusBandCell } from './plus-band-cell';
import { PlusCustomPriceCell } from './plus-custom-price-cell';

export interface PlusTariffsMobileCardsProps {
  rows: readonly PlusTariffDetailItem[];
  selection: PlusSelectionMap;
  onToggleJoin: (rowId: string) => void;
}

/**
 * Mobile layout: each product is a card with the current price/commission in the
 * header (right) and the single Plus offer as a full-width join card below, so
 * there is no horizontal scroll and the Plus card stays a large tap target.
 * Mirrors the commission mobile card (product header + current + band + custom
 * price); only the campaign logic differs (one Plus band vs a 2×2 band grid).
 * Shown below the `md` breakpoint; the desktop table is hidden there.
 */
export function PlusTariffsMobileCards({
  rows,
  selection,
  onToggleJoin,
}: PlusTariffsMobileCardsProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage');
  const reasonLabel = usePlusReasonLabel();

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
                  <Currency value={row.current.price} />
                </div>
                <div className="text-2xs text-muted-foreground tabular-nums">
                  {formatPercentDisplay(row.current.commissionPct)} {t('table.commission')}
                </div>
              </div>
            </div>
            <PlusBandCell
              row={row}
              selected={selection[row.id] === true}
              onToggle={() => onToggleJoin(row.id)}
            />
            <PlusCustomPriceCell row={row} />
          </div>
        );
      })}
    </div>
  );
}
