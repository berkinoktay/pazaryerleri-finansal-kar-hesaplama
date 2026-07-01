'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';

import type { SelectionMap } from '../lib/bulk-actions';
import type { BandKey, CommissionTariffRow } from '../types';
import { CustomPriceCell } from './custom-price-cell';
import { PriceBandCell } from './price-band-cell';

const BAND_INDEXES = [0, 1, 2, 3] as const;

export interface CommissionTariffsMobileCardsProps {
  rows: readonly CommissionTariffRow[];
  selection: SelectionMap;
  onSelectBand: (rowId: string, band: BandKey) => void;
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
  const format = useFormatter();

  return (
    <div className="gap-sm flex flex-col">
      {rows.map((row) => (
        <div key={row.id} className="border-border gap-sm p-md flex flex-col rounded-lg border">
          <div className="gap-sm flex items-start justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{row.productTitle}</div>
              <div className="text-2xs text-muted-foreground tabular-nums">
                {row.category} · {row.brand} · {t('table.stock')} {row.stock}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tabular-nums">
                <Currency value={row.currentPrice} />
              </div>
              <div className="text-2xs text-muted-foreground tabular-nums">
                {format.number(row.currentCommissionPct.toNumber(), 'percent')}{' '}
                {t('table.commission')}
              </div>
            </div>
          </div>
          <div className="gap-2xs grid grid-cols-2">
            {BAND_INDEXES.map((i) => {
              const band = row.bands[i];
              return (
                <PriceBandCell
                  key={band.key}
                  row={row}
                  band={band}
                  isBest={row.bestBand === band.key}
                  isCurrent={i === 0}
                  selected={selection[row.id] === band.key}
                  onSelect={(key) => onSelectBand(row.id, key)}
                />
              );
            })}
          </div>
          <CustomPriceCell row={row} />
        </div>
      ))}
    </div>
  );
}
