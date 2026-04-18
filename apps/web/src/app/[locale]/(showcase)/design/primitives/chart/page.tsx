'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';

import { PageHeader } from '@/components/patterns/page-header';
import { PrimitiveNav } from '@/components/showcase/primitive-nav';
import { Preview } from '@/components/showcase/preview';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

const REVENUE_CONFIG = {
  revenue: { label: 'Ciro', color: 'var(--chart-1)' },
  profit: { label: 'Net kar', color: 'var(--chart-3)' },
} satisfies ChartConfig;

const REVENUE_DATA = [
  { month: 'Oca', revenue: 186000, profit: 28000 },
  { month: 'Şub', revenue: 205000, profit: 31200 },
  { month: 'Mar', revenue: 237000, profit: 34800 },
  { month: 'Nis', revenue: 284390, profit: 48120 },
];

const ORDERS_CONFIG = {
  trendyol: { label: 'Trendyol', color: 'var(--chart-1)' },
  hepsiburada: { label: 'Hepsiburada', color: 'var(--chart-4)' },
} satisfies ChartConfig;

const ORDERS_DATA = [
  { week: 'H1', trendyol: 420, hepsiburada: 180 },
  { week: 'H2', trendyol: 510, hepsiburada: 210 },
  { week: 'H3', trendyol: 430, hepsiburada: 240 },
  { week: 'H4', trendyol: 612, hepsiburada: 268 },
];

const MARGIN_DATA = [
  { day: '1', margin: 11.2 },
  { day: '5', margin: 13.4 },
  { day: '10', margin: 16.8 },
  { day: '15', margin: 14.6 },
  { day: '17', margin: 18.1 },
];

const MARGIN_CONFIG = {
  margin: { label: 'Marj %', color: 'var(--chart-3)' },
} satisfies ChartConfig;

export default function ChartPrimitivePage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Grafik"
        intent="Recharts + token-aware ChartContainer. Renkler --chart-1..6 token'larından gelir, tooltip ChartTooltipContent ile sistemle uyumlu."
      />
      <PrimitiveNav />

      <Preview
        title="Line chart — dönemlik kar"
        description="Basit zaman serisi. Axis tickler muted, grid ince."
      >
        <ChartContainer config={MARGIN_CONFIG} className="aspect-[16/5]">
          <LineChart data={MARGIN_DATA} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={30} domain={[8, 20]} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              type="monotone"
              dataKey="margin"
              stroke="var(--color-margin)"
              strokeWidth={2}
              dot={{ r: 4, fill: 'var(--color-margin)' }}
            />
          </LineChart>
        </ChartContainer>
      </Preview>

      <Preview
        title="Area chart — ciro & net kar"
        description="İki serili area. Renkler config'ten, gradient yok — finansal ton."
      >
        <ChartContainer config={REVENUE_CONFIG} className="aspect-[16/6]">
          <AreaChart data={REVENUE_DATA}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={50}
              tickFormatter={(value: number) => `${Math.round(value / 1000)}K`}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="var(--color-revenue)"
              fill="var(--color-revenue)"
              fillOpacity={0.15}
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="profit"
              stroke="var(--color-profit)"
              fill="var(--color-profit)"
              fillOpacity={0.2}
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </Preview>

      <Preview
        title="Bar chart — pazaryeri bazında sipariş"
        description="Grouped bar. Pazaryeri rengi marka hue'sinden farklı olsun diye --chart-4 amber."
      >
        <ChartContainer config={ORDERS_CONFIG} className="aspect-[16/6]">
          <BarChart data={ORDERS_DATA}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="week" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={30} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="trendyol" fill="var(--color-trendyol)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="hepsiburada" fill="var(--color-hepsiburada)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </Preview>
    </>
  );
}
