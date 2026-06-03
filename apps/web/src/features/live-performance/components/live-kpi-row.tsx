'use client';

import Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatNumber, formatPercent } from '@pazarsync/utils';

import { Currency } from '@/components/patterns/currency';
import { StatCard, type StatCardDelta } from '@/components/patterns/stat-card';
import { StatGroup } from '@/components/patterns/stat-group';

import { useLiveKpis } from '../hooks/use-live-kpis';
import { computeDeltaPercent } from '../lib/compute-delta-percent';

interface LiveKpiRowProps {
  orgId: string;
  storeId: string;
}

/**
 * The four headline KPIs — Ciro / Net Kâr / Sipariş / Marj — each a today value
 * with a today-vs-yesterday TrendDelta. All four read "up is good" (revenue,
 * profit, orders, margin all improve when they rise). The delta chip is omitted
 * when yesterday was zero (relative change undefined) rather than rendering a
 * misleading "+∞%". The four cards share one query, so its loading / error state
 * drives every card's `status` (StatCard owns the matching skeleton / error
 * surface); retry is the page-header Refresh.
 */
export function LiveKpiRow({ orgId, storeId }: LiveKpiRowProps): React.ReactElement {
  const t = useTranslations('livePerformance.kpis');
  const query = useLiveKpis(orgId, storeId);
  const kpis = query.data;
  const status: 'ready' | 'loading' | 'error' = query.isPending
    ? 'loading'
    : query.isError
      ? 'error'
      : 'ready';

  return (
    <StatGroup>
      <StatCard
        status={status}
        label={t('revenue')}
        value={kpis ? <Currency value={kpis.revenueToday} /> : null}
        delta={kpis ? deltaProp(kpis.revenueToday, kpis.revenueYesterday) : undefined}
      />
      <StatCard
        status={status}
        label={t('netProfit')}
        value={kpis ? <Currency value={kpis.netProfitToday} /> : null}
        delta={kpis ? deltaProp(kpis.netProfitToday, kpis.netProfitYesterday) : undefined}
      />
      <StatCard
        status={status}
        label={t('orderCount')}
        value={kpis ? formatNumber(kpis.orderCountToday) : null}
        delta={
          kpis
            ? deltaProp(String(kpis.orderCountToday), String(kpis.orderCountYesterday))
            : undefined
        }
      />
      <StatCard
        status={status}
        label={t('margin')}
        value={kpis ? formatPercent(new Decimal(kpis.marginToday)) : null}
        delta={kpis ? deltaProp(kpis.marginToday, kpis.marginYesterday) : undefined}
      />
    </StatGroup>
  );
}

/**
 * Build the StatCard delta, or `undefined` when no relative change exists
 * (yesterday was zero). All four KPIs read "higher is better" → goodDirection up.
 */
function deltaProp(today: string, yesterday: string): StatCardDelta | undefined {
  const percent = computeDeltaPercent(today, yesterday);
  return percent === null ? undefined : { percent, goodDirection: 'up' };
}
