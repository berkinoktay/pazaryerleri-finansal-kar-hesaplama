'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatCurrency } from '@pazarsync/utils';

import { ProfitBadge } from '@/components/patterns/profit-badge';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { cn } from '@/lib/utils';

import { useEstimatePlusItemPrice } from '../hooks/use-estimate-plus-item-price';
import { useTariffScope } from '../lib/tariff-scope';
import type { PlusTariffDetailItem } from '../types';
import { PlusTariffBreakdown } from './plus-tariff-breakdown';
import { ProfitDelta } from './profit-delta';
import { TariffSelectControl } from './tariff-select-control';

export interface PlusBandCellProps {
  row: PlusTariffDetailItem;
  /** Whether the seller has joined Plus AT THE CEILING for this product. */
  selected: boolean;
  /** Toggle the ceiling join (re-tap un-joins). */
  onToggle: () => void;
  /**
   * Center the cell's content — used in the desktop table column (all non-product
   * columns are centered). Off (left-aligned) for the mobile card zone.
   */
  centered?: boolean;
}

/**
 * The Plus offer as a flat, un-boxed choice: the ceiling price + reduced commission,
 * the calculated profit + "vs current" delta, then a single explicit {@link
 * TariffSelectControl} ("Tavan fiyata katıl"). No click-anywhere overlay — every
 * selectable option on the row shares the same distinct radio-button affordance.
 */
export function PlusBandCell({
  row,
  selected,
  onToggle,
  centered = false,
}: PlusBandCellProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage.table');
  const scale = useMarginColoring();
  const scope = useTariffScope();
  const estimate = useEstimatePlusItemPrice(scope.orgId, scope.storeId, scope.tariffId);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);

  function openBreakdown(): void {
    setBreakdownOpen(true);
    estimate.mutate({ itemId: row.id, body: { price: row.plus.price } });
  }

  const items = centered ? 'items-center' : 'items-start';
  const self = centered ? 'self-center' : 'self-start';

  return (
    <div className={cn('gap-sm flex min-w-0 flex-col', items, centered && 'w-full text-center')}>
      <div className={cn('gap-3xs flex min-w-0 flex-col', items)}>
        {/* Price ceiling + its "ve altı" qualifier as one hero unit. */}
        <span
          className={cn(
            'gap-x-2xs flex min-w-0 flex-wrap items-baseline',
            centered && 'justify-center',
          )}
        >
          <span className="text-base font-bold tabular-nums">{formatCurrency(row.plus.price)}</span>
          <span className="text-xs font-normal">{t('ceilingQualifier')}</span>
        </span>
        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('plusCommission')} {formatPercentDisplay(row.plus.commissionPct)}
        </span>
      </div>

      <div className={cn('gap-3xs flex flex-col', items)}>
        <span className="text-2xs text-muted-foreground">{t('calculatedProfit')}</span>
        <ProfitBadge
          value={row.plus.netProfit}
          marginPct={row.plus.marginPct}
          scale={scale}
          onOpen={openBreakdown}
          showMarginPct
          className={self}
        />
        {/* "Güncele göre +₺X" — how much joining beats doing nothing. */}
        <ProfitDelta
          optionNetProfit={row.plus.netProfit}
          currentNetProfit={row.current.netProfit}
          label={t('vsCurrent')}
        />
      </div>

      <TariffSelectControl
        selected={selected}
        onToggle={onToggle}
        label={t('join')}
        selectedLabel={t('joined')}
        className={self}
      />

      <PlusTariffBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        productTitle={row.productTitle}
        imageUrl={row.imageUrl}
        result={estimate.data ?? null}
        loading={estimate.isPending}
      />
    </div>
  );
}
