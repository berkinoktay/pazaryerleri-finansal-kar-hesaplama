'use client';

import * as React from 'react';

import { ProductImageCell } from '@/components/patterns/product-image-cell';

import type { PlusSelectionMap } from '../lib/plus-bulk-actions';
import type { PlusTariffDetailItem } from '../types';
import { PlusCustomPriceCell } from './plus-custom-price-cell';
import { PlusOfferCell } from './plus-offer-cell';

export interface PlusTariffsMobileCardsProps {
  rows: readonly PlusTariffDetailItem[];
  selection: PlusSelectionMap;
  onToggleJoin: (rowId: string) => void;
}

/**
 * Mobile layout: each product is a card with its current-vs-Plus comparison + join
 * toggle stacked below the product header, so there is no horizontal scroll and the
 * whole Plus block stays a large tap target. Shown below the `md` breakpoint; the
 * desktop table is hidden there.
 */
export function PlusTariffsMobileCards({
  rows,
  selection,
  onToggleJoin,
}: PlusTariffsMobileCardsProps): React.ReactElement {
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
            <div className="gap-sm flex min-w-0 items-start">
              <ProductImageCell url={row.imageUrl} alt={row.productTitle} size="lg" />
              <div className="min-w-0">
                <div className="line-clamp-2 text-sm font-medium">{row.productTitle}</div>
                <div className="text-2xs text-muted-foreground tabular-nums">
                  {[categoryBrand, row.stockCode].filter((v) => v !== null && v !== '').join(' · ')}
                </div>
              </div>
            </div>
            <PlusOfferCell
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
