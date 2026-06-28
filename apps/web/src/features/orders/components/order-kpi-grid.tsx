'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { StatCard } from '@/components/patterns/stat-card';
import { formatPercentDisplay } from '@/lib/format-percent';
import { cn } from '@/lib/utils';

import { type OrderDetail } from '../api/get-order.api';

export interface OrderKpiGridProps {
  order: Pick<
    OrderDetail,
    | 'saleGross'
    | 'estimatedNetProfit'
    | 'settledNetProfit'
    | 'profitBreakdown'
    | 'reconciliationStatus'
  >;
  /** Dense (modal/sheet) → 2 columns so labels/values never truncate; default 4-col (full page). */
  dense?: boolean;
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
export function OrderKpiGrid({ order, dense = false }: OrderKpiGridProps): React.ReactElement {
  const t = useTranslations('orderDetail.kpis');

  // Satış KPI = NET satış (iade düşülmüş) → kâr dökümüyle tutarlı (Berkin kararı
  // 2026-06-20). Backend-hesaplı `profitBreakdown.saleGross` zaten netted; breakdown
  // yoksa (profit-excluded) ham order.saleGross'a düşülür. Frontend türetme YOK.
  const netSaleGross = order.profitBreakdown?.saleGross ?? order.saleGross;
  const estimatedProfit = order.estimatedNetProfit;
  const settledProfit = order.settledNetProfit;
  const marginPct = order.profitBreakdown?.saleMarginPct ?? null;

  // Fiili kâr alt-metni: settled yazıldıysa açıkla; yazılmadıysa mutabakat
  // DURUMUNU yansıt — PARTIALLY_SETTLED'da "hiç işlenmedi" YANLIŞ (hakediş satırı geldi,
  // tam mutabakat bekleniyor). reconciliationStatus backend-servisli.
  const settledContext =
    settledProfit !== null
      ? t('settledNetProfit.hint')
      : order.reconciliationStatus === 'PARTIALLY_SETTLED'
        ? t('settledNetProfit.partial')
        : t('settledNetProfit.pending');

  return (
    <div className={cn('gap-md grid grid-cols-1 sm:grid-cols-2', !dense && 'lg:grid-cols-4')}>
      <StatCard
        label={t('saleGross.label')}
        value={<Currency value={netSaleGross ?? '0'} animate />}
        context={netSaleGross === null ? t('common.notAvailable') : undefined}
      />
      <StatCard
        label={t('estimatedNetProfit.label')}
        value={<Currency value={estimatedProfit ?? '0'} animate />}
        context={estimatedProfit === null ? t('common.notAvailable') : t('estimatedNetProfit.hint')}
      />
      <StatCard
        label={t('settledNetProfit.label')}
        value={<Currency value={settledProfit ?? '0'} animate />}
        context={settledContext}
      />
      <StatCard
        label={t('margin.label')}
        value={formatPercentDisplay(marginPct)}
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
