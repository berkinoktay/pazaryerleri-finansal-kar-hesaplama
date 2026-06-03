'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { getBusinessHour } from '@pazarsync/utils';

import { CHART_COMPARISON, resolveValueColor } from '@/components/patterns/chart-colors';
import { ChartFrame, type ChartFrameLegendItem } from '@/components/patterns/chart-frame';
import { LineChart } from '@/components/patterns/chart-line';
import type { ChartStatus } from '@/components/patterns/chart.types';
import { Currency } from '@/components/patterns/currency';

import { useLiveChart } from '../hooks/use-live-chart';
import { buildChartSeries } from '../lib/build-chart-series';

interface LiveProfitChartProps {
  orgId: string;
  storeId: string;
  /** Realtime channel is healthy → show the live badge + the "now" edge dot. */
  live: boolean;
}

/** `14` → `14:00` — the x-axis hour tick. */
function formatHour(value: string | number): string {
  return `${String(value).padStart(2, '0')}:00`;
}

/**
 * Hourly cumulative-profit comparison: today (semantic kâr/zarar area) vs
 * yesterday (muted dashed reference). The chart-kit `LineChart` owns the dual-
 * series idiom — the dashed comparison line, the two-row tooltip, and the
 * pulsing `liveDot` that marks today's leading edge where the subject line stops
 * at "now". Recharts is untestable in happy-dom, so the data-shaping
 * (`buildChartSeries`) is unit-tested and this component is dynamically imported
 * (ssr:false) — reading the client's current business hour here is therefore
 * safe (no server render to desync).
 */
export function LiveProfitChart({
  orgId,
  storeId,
  live,
}: LiveProfitChartProps): React.ReactElement {
  const t = useTranslations('livePerformance.chart');
  const query = useLiveChart(orgId, storeId);

  const shaped = React.useMemo(() => {
    if (query.data === undefined) {
      return { rows: [], todayTotal: 0, yesterdayTotal: 0, isEmptyData: true };
    }
    // Recomputed on every data refresh (Realtime / poll), so the "now" edge
    // advances with the wall clock as new hours of orders arrive.
    const currentHour = getBusinessHour(new Date());
    const rows = buildChartSeries(query.data.today, query.data.yesterday, currentHour);
    return {
      rows,
      todayTotal: Number(rows[currentHour]?.today ?? 0),
      yesterdayTotal: Number(rows[rows.length - 1]?.yesterday ?? 0),
      isEmptyData: query.data.today.length === 0 && query.data.yesterday.length === 0,
    };
  }, [query.data]);

  const status: ChartStatus = query.isPending
    ? 'loading'
    : query.isError
      ? 'error'
      : shaped.isEmptyData
        ? 'empty'
        : 'ready';

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
