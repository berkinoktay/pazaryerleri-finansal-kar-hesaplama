'use client';

import Decimal from 'decimal.js';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { StatCard } from '@/components/patterns/stat-card';

import { type OrderDetail } from '../api/get-order.api';

export interface OrderKpiGridProps {
  order: Pick<OrderDetail, 'saleSubtotalNet' | 'estimatedNetProfit' | 'settledNetProfit'>;
}

/**
 * 4-tile KPI strip at the top of the order detail: net sale subtotal, estimated
 * and settled net profit, and the derived margin. All four are plain `StatCard`s
 * — the margin renders a percentage directly now that StatCard's `value` is a
 * node (no feature-local primitive fork as the old KpiTile's currency/count
 * value-kind needed).
 */
export function OrderKpiGrid({ order }: OrderKpiGridProps): React.ReactElement {
  const t = useTranslations('orderDetail.kpis');
  const formatter = useFormatter();

  const saleNet = order.saleSubtotalNet;
  const estimatedProfit = order.estimatedNetProfit;
  const settledProfit = order.settledNetProfit;
  const effectiveProfit = settledProfit ?? estimatedProfit;

  const marginPercent = computeMarginPercent(saleNet, effectiveProfit);

  return (
    <div className="gap-md grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label={t('saleSubtotalNet.label')}
        value={<Currency value={saleNet ?? '0'} />}
        context={saleNet === null ? t('common.notAvailable') : undefined}
      />
      <StatCard
        label={t('estimatedNetProfit.label')}
        value={<Currency value={estimatedProfit ?? '0'} />}
        context={estimatedProfit === null ? t('common.notAvailable') : t('estimatedNetProfit.hint')}
      />
      <StatCard
        label={t('settledNetProfit.label')}
        value={<Currency value={settledProfit ?? '0'} />}
        context={
          settledProfit === null ? t('settledNetProfit.pending') : t('settledNetProfit.hint')
        }
      />
      <StatCard
        label={t('margin.label')}
        value={
          marginPercent === null ? '—' : `${formatter.number(marginPercent.toNumber(), 'decimal')}%`
        }
        context={
          marginPercent === null
            ? t('common.notAvailable')
            : settledProfit !== null
              ? t('margin.basisSettled')
              : t('margin.basisEstimated')
        }
      />
    </div>
  );
}

function computeMarginPercent(saleNet: string | null, profit: string | null): Decimal | null {
  if (saleNet === null || profit === null) return null;
  const sale = new Decimal(saleNet);
  if (sale.isZero()) return null;
  return new Decimal(profit).div(sale).mul(100).toDecimalPlaces(1);
}
