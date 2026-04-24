'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { parseAsStringEnum, useQueryState } from 'nuqs';

import { KpiTile } from '@/components/patterns/kpi-tile';
import { StatGroup } from '@/components/patterns/stat-group';
import { CostBreakdownCard } from '@/features/dashboard/components/cost-breakdown-card';
import { NetProfitFunnelCard } from '@/features/dashboard/components/net-profit-funnel-card';
import { OrderMetricsCard } from '@/features/dashboard/components/order-metrics-card';
import { PERIOD_PRESETS, type PeriodKey } from '@/features/dashboard/components/period-preset-list';
import { ProductMetricsCard } from '@/features/dashboard/components/product-metrics-card';
import { ProfitTrendCard } from '@/features/dashboard/components/profit-trend-card';
import { TopProductsCard } from '@/features/dashboard/components/top-products-card';
import { useDashboardMetrics } from '@/features/dashboard/hooks/use-dashboard-metrics';

const PERIOD_KEYS = PERIOD_PRESETS.map((p) => p.key);

export interface DashboardBodyProps {
  orgId: string;
  storeId: string;
}

/**
 * Client-side composition of the dashboard body.
 *
 * - Owns the `?period=` URL state (single source of truth — sidebar preset
 *   list + this hook both read/write the same param via nuqs).
 * - Drives `useDashboardMetrics` and feeds the resulting `DashboardMetrics`
 *   shape into the seven body cards (5 KPI tiles, cost donut, profit trend,
 *   product metrics, funnel, order metrics, top profitable, top lossy).
 * - The same normalized profit-trend points feed the sparkline watermark on
 *   every value-tile (Ciro, Maliyetli ciro, Net kâr, İade) so the visual
 *   rhythm reads as one period across the whole row. Kâr/Satış is a
 *   percentage and intentionally has no sparkline.
 */
export function DashboardBody({ orgId, storeId }: DashboardBodyProps): React.ReactElement {
  const t = useTranslations();
  const [period] = useQueryState(
    'period',
    parseAsStringEnum<PeriodKey>(PERIOD_KEYS).withDefault('last-30d'),
  );
  const { data } = useDashboardMetrics({ orgId, storeId, period });

  const trendPoints = (data?.profitTrend ?? []).map((p) => Number(p.profit));
  const trendNorm = normalize(trendPoints);

  return (
    <>
      <StatGroup>
        <KpiTile
          label={t('dashboard.kpi.revenue')}
          value={{ kind: 'currency', amount: data?.kpis.revenue ?? '0' }}
          delta={data ? { percent: data.kpis.revenueDelta, goodDirection: 'up' } : undefined}
          sparkline={trendNorm}
          sparklineTone="primary"
        />
        <KpiTile
          label={t('dashboard.kpi.costedRevenue')}
          value={{ kind: 'currency', amount: data?.kpis.costedRevenue ?? '0' }}
          delta={data ? { percent: data.kpis.costedRevenueDelta, goodDirection: 'up' } : undefined}
          sparkline={trendNorm}
        />
        <KpiTile
          label={t('dashboard.kpi.netProfit')}
          value={{ kind: 'currency', amount: data?.kpis.netProfit ?? '0' }}
          delta={data ? { percent: data.kpis.netProfitDelta, goodDirection: 'up' } : undefined}
          sparkline={trendNorm}
          sparklineTone="success"
        />
        <KpiTile
          label={t('dashboard.kpi.profitMargin')}
          value={{ kind: 'percent', amount: data?.kpis.profitMarginPercent ?? 0 }}
          delta={
            data ? { percent: data.kpis.profitMarginDeltaPoints, goodDirection: 'up' } : undefined
          }
        />
        <KpiTile
          label={t('dashboard.kpi.returns')}
          value={{ kind: 'count', amount: data?.kpis.returnCount ?? 0 }}
          delta={data ? { percent: data.kpis.returnDelta, goodDirection: 'down' } : undefined}
          sparkline={trendNorm}
          sparklineTone="warning"
        />
      </StatGroup>

      <CostBreakdownCard entries={data?.costBreakdown} />

      <div className="gap-lg grid grid-cols-1 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProfitTrendCard points={data?.profitTrend} />
        </div>
        <ProductMetricsCard data={data?.productMetrics} />
      </div>

      <div className="gap-lg grid grid-cols-1 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NetProfitFunnelCard steps={data?.funnel} />
        </div>
        <OrderMetricsCard data={data?.orderMetrics} />
      </div>

      <div className="gap-lg grid grid-cols-1 md:grid-cols-2">
        <TopProductsCard variant="profitable" products={data?.topProfitable} />
        <TopProductsCard variant="lossy" products={data?.topLossy} />
      </div>
    </>
  );
}

function normalize(points: readonly number[]): readonly number[] {
  if (points.length === 0) return points;
  const min = Math.min(...points);
  const max = Math.max(...points);
  if (max === min) return points.map(() => 0.5);
  return points.map((p) => (p - min) / (max - min));
}
