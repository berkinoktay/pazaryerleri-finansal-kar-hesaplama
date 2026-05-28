'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';

import { useLiveChart } from '../hooks/use-live-chart';
import { buildChartSeries } from '../lib/build-chart-series';

interface LiveProfitChartProps {
  orgId: string;
  storeId: string;
}

/** Sparse, legible x-axis: a tick every six hours plus the end of the day. */
const HOUR_TICKS = [0, 6, 12, 18, 23] as const;

/**
 * Hourly cumulative-profit dual line: today (solid, primary) vs yesterday
 * (dashed, muted) — the "actual vs reference" financial idiom, distinguished by
 * both color and line style for color-blind safety. Recharts is untestable in
 * happy-dom, so the data-shaping (buildChartSeries) is unit-tested and this
 * component is dynamically imported (ssr:false) where it's mounted.
 */
export function LiveProfitChart({ orgId, storeId }: LiveProfitChartProps): React.ReactElement {
  const t = useTranslations('livePerformance.chart');
  const formatter = useFormatter();
  const query = useLiveChart(orgId, storeId);

  const config = {
    today: { label: t('todayLabel'), color: 'var(--chart-1)' },
    yesterday: { label: t('yesterdayLabel'), color: 'var(--chart-3)' },
  } satisfies ChartConfig;

  const data = React.useMemo(
    () => (query.data ? buildChartSeries(query.data.today, query.data.yesterday) : []),
    [query.data],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {query.data === undefined ? (
          <Skeleton className="aspect-[16/6] w-full" />
        ) : (
          <ChartContainer config={config} className="aspect-[16/6] w-full">
            <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="hour"
                tickLine={false}
                axisLine={false}
                ticks={[...HOUR_TICKS]}
                tickFormatter={(hour: number) => `${String(hour).padStart(2, '0')}:00`}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(value: number) => formatter.number(value, 'integer')}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Line
                type="monotone"
                dataKey="today"
                stroke="var(--color-today)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="yesterday"
                stroke="var(--color-yesterday)"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
