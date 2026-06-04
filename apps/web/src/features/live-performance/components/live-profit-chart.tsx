'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { getBusinessHour } from '@pazarsync/utils';

import { CHART_COMPARISON, resolveValueColor } from '@/components/patterns/chart-colors';
import { ChartFrame, type ChartFrameLegendItem } from '@/components/patterns/chart-frame';
import { LineChart } from '@/components/patterns/chart-line';
import type { ChartPeriodControl, ChartStatus } from '@/components/patterns/chart.types';
import { Currency } from '@/components/patterns/currency';

import { useLiveChart } from '../hooks/use-live-chart';
import { buildChartSeries, type ChartMetric } from '../lib/build-chart-series';

/** `14` → `14:00` — the x-axis hour tick. */
function formatHour(value: string | number): string {
  return `${String(value).padStart(2, '0')}:00`;
}

function isMetric(value: string): value is ChartMetric {
  return value === 'revenue' || value === 'profit';
}

/**
 * Hourly cumulative comparison with a ciro↔kâr toggle: the measured series (today,
 * a semantic area) swaps between cumulative revenue and cumulative profit while
 * yesterday stays the muted dashed reference. The chart-kit `LineChart` owns the
 * dual-series idiom (dashed comparison, two-row tooltip, pulsing `liveDot` at
 * today's leading edge). Recharts is untestable in happy-dom, so the data-shaping
 * (`buildChartSeries`) is unit-tested and this component is dynamically imported
 * (ssr:false) — reading the client's current business hour here is safe.
 */
export function LiveProfitChart({
  orgId,
  storeId,
  live,
}: {
  orgId: string;
  storeId: string;
  /** Realtime channel is healthy → show the live badge + the "now" edge dot. */
  live: boolean;
}): React.ReactElement {
  const t = useTranslations('livePerformance.chart');
  const [metric, setMetric] = React.useState<ChartMetric>('revenue');
  const query = useLiveChart(orgId, storeId);

  const shaped = React.useMemo(() => {
    if (query.data === undefined) {
      return { rows: [], todayTotal: 0, yesterdayTotal: 0, isEmptyData: true };
    }
    // Recomputed on every data refresh and on every toggle, so the "now" edge
    // advances with the wall clock and the series matches the active metric.
    const currentHour = getBusinessHour(new Date());
    const rows = buildChartSeries(query.data.today, query.data.yesterday, currentHour, metric);
    return {
      rows,
      todayTotal: Number(rows[currentHour]?.today ?? 0),
      yesterdayTotal: Number(rows[rows.length - 1]?.yesterday ?? 0),
      isEmptyData: query.data.today.length === 0 && query.data.yesterday.length === 0,
    };
  }, [query.data, metric]);

  const status: ChartStatus = query.isPending
    ? 'loading'
    : query.isError
      ? 'error'
      : shaped.isEmptyData
        ? 'empty'
        : 'ready';

  const metricTabs: ChartPeriodControl = {
    value: metric,
    options: [
      { value: 'revenue', label: t('metricRevenue') },
      { value: 'profit', label: t('metricProfit') },
    ],
    onValueChange: (next) => {
      if (isMetric(next)) setMetric(next);
    },
    ariaLabel: t('title'),
  };

  const legend: ChartFrameLegendItem[] = [
    {
      label: t('todayLabel'),
      value: <Currency value={shaped.todayTotal} />,
      swatch: resolveValueColor(shaped.todayTotal),
    },
    {
      label: t('yesterdayLabel'),
      value: <Currency value={shaped.yesterdayTotal} />,
      swatch: CHART_COMPARISON,
      reference: true,
    },
  ];

  return (
    <ChartFrame
      title={t('title')}
      metricTabs={metricTabs}
      value={status === 'ready' ? <Currency value={shaped.todayTotal} /> : undefined}
      status={status}
      chartKind="line"
      liveBadge={live}
      legend={status === 'ready' ? legend : undefined}
      emptyHint={t('emptyHint')}
      onRetry={() => void query.refetch()}
    >
      <LineChart
        data={status === 'empty' ? [] : shaped.rows}
        xKey="hour"
        series={{ key: 'today', label: t('todayLabel'), format: 'currency' }}
        comparison={{ key: 'yesterday', label: t('yesterdayLabel'), format: 'currency' }}
        colorMode="semantic"
        variant="area"
        liveDot={live}
        xTickFormatter={formatHour}
        ariaLabel={t('title')}
      />
    </ChartFrame>
  );
}
