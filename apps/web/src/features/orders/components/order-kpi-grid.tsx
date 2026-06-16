'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { StatCard } from '@/components/patterns/stat-card';

import { type OrderDetail } from '../api/get-order.api';

export interface OrderKpiGridProps {
  order: Pick<
    OrderDetail,
    'saleGross' | 'estimatedNetProfit' | 'settledNetProfit' | 'profitBreakdown'
  >;
}

/**
 * 4-tile KPI strip at the top of the order detail: gross sale total, estimated
 * and settled net profit, and the margin. All four are plain `StatCard`s.
 *
 * **Hiçbir finansal değer frontend'de hesaplanmaz** (feedback_no_frontend_financial_calculation):
 * marj backend'de `buildProfitBreakdown` ile hesaplanıp `profitBreakdown.saleMarginPct`
 * olarak servis edilir — burada SADECE render edilir. (Order'da ayrı bir
 * estimated/settledSaleMarginPct alanı servis EDİLMEZ; tek servisli marj kaynağı
 * kâr dökümünün içindeki `saleMarginPct`'tir.)
 */
export function OrderKpiGrid({ order }: OrderKpiGridProps): React.ReactElement {
  const t = useTranslations('orderDetail.kpis');

  const saleGross = order.saleGross;
  const estimatedProfit = order.estimatedNetProfit;
  const settledProfit = order.settledNetProfit;
  const marginPct = order.profitBreakdown?.saleMarginPct ?? null;

  return (
    <div className="gap-md grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label={t('saleGross.label')}
        value={<Currency value={saleGross ?? '0'} />}
        context={saleGross === null ? t('common.notAvailable') : undefined}
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
        value={marginPct === null ? '—' : `${marginPct}%`}
        context={
          marginPct === null
            ? t('common.notAvailable')
            : settledProfit !== null
              ? t('margin.basisSettled')
              : t('margin.basisEstimated')
        }
      />
    </div>
  );
}
