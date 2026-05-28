'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { KpiTile } from '@/components/patterns/kpi-tile';
import { StatGroup } from '@/components/patterns/stat-group';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { useLiveKpis } from '../hooks/use-live-kpis';
import { computeDeltaPercent } from '../lib/compute-delta-percent';

interface LiveKpiRowProps {
  orgId: string;
  storeId: string;
}

/**
 * The four headline KPIs — Ciro / Net Kâr / Sipariş / Marj — each as a today
 * value with a today-vs-yesterday TrendDelta. Revenue/profit/order-count read
 * "up is good"; margin too. The delta chip is omitted when yesterday was zero
 * (relative change undefined) rather than rendering a misleading "+∞%".
 */
export function LiveKpiRow({ orgId, storeId }: LiveKpiRowProps): React.ReactElement {
  const t = useTranslations('livePerformance.kpis');
  const query = useLiveKpis(orgId, storeId);

  if (query.data === undefined) {
    return <LiveKpiRowSkeleton />;
  }

  const kpis = query.data;

  return (
    <StatGroup>
      <KpiTile
        label={t('revenue')}
        value={{ kind: 'currency', amount: kpis.revenueToday }}
        delta={deltaProp(kpis.revenueToday, kpis.revenueYesterday)}
      />
      <KpiTile
        label={t('netProfit')}
        value={{ kind: 'currency', amount: kpis.netProfitToday }}
        delta={deltaProp(kpis.netProfitToday, kpis.netProfitYesterday)}
      />
      <KpiTile
        label={t('orderCount')}
        value={{ kind: 'count', amount: kpis.orderCountToday }}
        delta={deltaProp(String(kpis.orderCountToday), String(kpis.orderCountYesterday))}
      />
      <KpiTile
        label={t('margin')}
        value={{ kind: 'percent', amount: kpis.marginToday }}
        delta={deltaProp(kpis.marginToday, kpis.marginYesterday)}
      />
    </StatGroup>
  );
}

/**
 * Build the KpiTile delta prop, or `undefined` when no relative change exists.
 * `goodDirection` defaults to 'up' in TrendDelta — all four KPIs read "higher is
 * better" — so it's omitted here.
 */
function deltaProp(today: string, yesterday: string): { percent: number } | undefined {
  const percent = computeDeltaPercent(today, yesterday);
  return percent === null ? undefined : { percent };
}

function LiveKpiRowSkeleton(): React.ReactElement {
  return (
    <StatGroup aria-hidden>
      {Array.from({ length: 4 }, (_, index) => (
        <Card key={index} className="gap-md p-lg flex flex-col justify-between">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-28" />
        </Card>
      ))}
    </StatGroup>
  );
}
