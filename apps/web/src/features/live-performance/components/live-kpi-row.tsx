'use client';

import Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatNumber, formatPercent } from '@pazarsync/utils';

import { Currency } from '@/components/patterns/currency';
import { StatCard, type StatCardDelta } from '@/components/patterns/stat-card';
import { StatGroup } from '@/components/patterns/stat-group';

import type { LivePerformanceKpis } from '../api/get-live-kpis.api';
import { useLiveKpis } from '../hooks/use-live-kpis';
import { computeDeltaPercent } from '../lib/compute-delta-percent';

/** Keys available under the `livePerformance.kpis` i18n namespace. */
type KpiKey =
  | 'revenue'
  | 'orderCount'
  | 'unitsSold'
  | 'netProfit'
  | 'margin'
  | 'profitCostRatio'
  | 'estimateHint'
  | 'pendingHint';

interface KpiCardDescriptor {
  key: string;
  /** i18n key under `livePerformance.kpis`. */
  labelKey: KpiKey;
  /** Headline value node (Currency / number / percent). */
  value: (k: LivePerformanceKpis) => React.ReactNode;
  /** [today, yesterday] decimal strings for the delta chip. */
  deltaPair: (k: LivePerformanceKpis) => [string, string];
  /** ⓘ note key — only the profit-family cards explain the estimate. */
  hintKey?: KpiKey;
  /** Pending-cost count for the gap sub-label (Kâr Tutarı only). */
  pending?: (k: LivePerformanceKpis) => number;
}

/**
 * The six headline KPIs. Volume (Ciro / Sipariş / Satış) reads the whole
 * today-universe; profit (Kâr Tutarı / Marj / Kâr-Maliyet) reads the costed
 * subset only — so the profit cards carry an ⓘ "estimate" note and the Kâr
 * Tutarı card shows how many orders are still awaiting cost (the gap that
 * explains "why is profit lower than revenue?"). All read "up is good"; the
 * delta chip is omitted when yesterday was zero. The six cards share one query,
 * so its loading / error state drives every card's `status`.
 */
const KPI_CARDS: KpiCardDescriptor[] = [
  {
    key: 'revenue',
    labelKey: 'revenue',
    value: (k) => <Currency value={k.revenueToday} />,
    deltaPair: (k) => [k.revenueToday, k.revenueYesterday],
  },
  {
    key: 'orderCount',
    labelKey: 'orderCount',
    value: (k) => formatNumber(k.orderCountToday),
    deltaPair: (k) => [String(k.orderCountToday), String(k.orderCountYesterday)],
  },
  {
    key: 'unitsSold',
    labelKey: 'unitsSold',
    value: (k) => formatNumber(k.unitsSoldToday),
    deltaPair: (k) => [String(k.unitsSoldToday), String(k.unitsSoldYesterday)],
  },
  {
    key: 'netProfit',
    labelKey: 'netProfit',
    value: (k) => <Currency value={k.netProfitToday} />,
    deltaPair: (k) => [k.netProfitToday, k.netProfitYesterday],
    hintKey: 'estimateHint',
    pending: (k) => k.pendingOrderCountToday,
  },
  {
    key: 'margin',
    labelKey: 'margin',
    value: (k) => formatPercent(new Decimal(k.marginToday)),
    deltaPair: (k) => [k.marginToday, k.marginYesterday],
    hintKey: 'estimateHint',
  },
  {
    key: 'profitCostRatio',
    labelKey: 'profitCostRatio',
    value: (k) => formatPercent(new Decimal(k.profitCostRatioToday)),
    deltaPair: (k) => [k.profitCostRatioToday, k.profitCostRatioYesterday],
    hintKey: 'estimateHint',
  },
];

export function LiveKpiRow({
  orgId,
  storeId,
}: {
  orgId: string;
  storeId: string;
}): React.ReactElement {
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
      {KPI_CARDS.map((card) => {
        const pair = kpis ? card.deltaPair(kpis) : undefined;
        const pendingCount = kpis && card.pending ? card.pending(kpis) : 0;
        return (
          <StatCard
            key={card.key}
            status={status}
            label={t(card.labelKey)}
            value={kpis ? card.value(kpis) : null}
            hint={card.hintKey ? t(card.hintKey) : undefined}
            delta={pair ? deltaProp(pair[0], pair[1]) : undefined}
            context={pendingCount > 0 ? t('pendingHint', { count: pendingCount }) : undefined}
          />
        );
      })}
    </StatGroup>
  );
}

/**
 * Build the StatCard delta, or `undefined` when no relative change exists
 * (yesterday was zero). All six KPIs read "higher is better" → goodDirection up.
 */
function deltaProp(today: string, yesterday: string): StatCardDelta | undefined {
  const percent = computeDeltaPercent(today, yesterday);
  return percent === null ? undefined : { percent, goodDirection: 'up' };
}
