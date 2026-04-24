'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Card } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { DashboardTrendPoint } from '@/features/dashboard/api/dashboard.api';

export interface ProfitTrendCardProps {
  points: readonly DashboardTrendPoint[] | undefined;
}

/**
 * Area line chart of net profit over the selected period. Stroke uses the
 * success token; the fill is a vertical gradient à la Stripe / Vercel so
 * the curve carries weight without dominating the card.
 *
 * `--color-profit` is injected at runtime by `ChartContainer` from the
 * `chartConfig.profit.color` mapping — Recharts children resolve it via
 * `var(--color-profit)` without hardcoding hex values. The config is
 * built inside the component so its label can flow through `t()`.
 *
 * Date labels go through next-intl's `'date'` preset (dateStyle: 'short')
 * so the axis stays compact (`21.04.2026`) without including time.
 */
export function ProfitTrendCard({ points }: ProfitTrendCardProps): React.ReactElement {
  const t = useTranslations();
  const formatter = useFormatter();

  const chartConfig = {
    profit: { label: t('dashboard.kpi.netProfit'), color: 'var(--color-success)' },
  } satisfies ChartConfig;

  const data = (points ?? []).map((point) => ({
    date: point.date,
    profit: Number(point.profit.toFixed(2)),
    label: formatter.dateTime(new Date(point.date), 'date'),
  }));

  return (
    <Card className="gap-md p-lg flex flex-col">
      <header className="flex items-center justify-between">
        <h2 className="text-foreground text-base font-semibold">
          {t('dashboard.section.profitTrend')}
        </h2>
      </header>
      <ChartContainer config={chartConfig} className="aspect-video w-full">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="profit-trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="var(--color-profit)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="var(--color-profit)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            type="monotone"
            dataKey="profit"
            stroke="var(--color-profit)"
            strokeWidth={2}
            fill="url(#profit-trend-fill)"
          />
        </AreaChart>
      </ChartContainer>
    </Card>
  );
}
