'use client';

import type { Decimal } from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MoneyInput } from '@/components/patterns/money-input';
import { ProfitBadge } from '@/components/patterns/profit-badge';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import type { TariffBreakdown } from '../lib/build-band-breakdown';
import { estimateCustomPrice } from '../lib/estimate-custom-price';
import type { CommissionTariffRow } from '../types';
import { CommissionTariffBreakdown } from './commission-tariff-breakdown';

/**
 * Custom-price "what-if" field. Owns its own price state so typing never
 * rebuilds the table column defs (which would steal focus). As the seller types,
 * we map the price to the band it falls into and show an estimated profit via the
 * shared {@link ProfitBadge} (margin-colored, same chip as orders); clicking it
 * opens the income/expense breakdown — like the band cards. MOCK estimate (the
 * backend computes the authoritative value).
 */
export function CustomPriceCell({ row }: { row: CommissionTariffRow }): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const tBreakdown = useTranslations('commissionTariffsPage.breakdown');
  const scale = useMarginColoring();
  const [price, setPrice] = React.useState<Decimal | null>(null);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  const estimate = price !== null && price.greaterThan(0) ? estimateCustomPrice(row, price) : null;

  const breakdown: TariffBreakdown | null =
    price !== null && estimate !== null
      ? {
          price,
          commissionPct: estimate.commissionPct,
          commission: price.times(estimate.commissionPct),
          unitCost: row.unitCost,
          profit: estimate.profit,
          marginPct: estimate.marginPct,
        }
      : null;

  return (
    <div className="gap-3xs flex flex-col">
      <MoneyInput
        value={price}
        onChange={setPrice}
        nonNegative
        aria-label={`${t('table.customPrice')} — ${row.productTitle}`}
        placeholder={t('table.enterPrice')}
        className="max-w-input-narrow"
      />
      {estimate !== null && breakdown !== null ? (
        <div className="gap-3xs flex items-center">
          <span className="text-2xs text-muted-foreground">≈</span>
          <ProfitBadge
            value={estimate.profit}
            marginPct={estimate.marginPct}
            scale={scale}
            onOpen={() => setBreakdownOpen(true)}
          />
          <CommissionTariffBreakdown
            open={breakdownOpen}
            onOpenChange={setBreakdownOpen}
            productTitle={row.productTitle}
            breakdown={breakdown}
            profitLabel={tBreakdown('estimatedProfit')}
          />
        </div>
      ) : (
        <span className="text-2xs text-muted-foreground">{t('table.customPriceHint')}</span>
      )}
    </div>
  );
}
