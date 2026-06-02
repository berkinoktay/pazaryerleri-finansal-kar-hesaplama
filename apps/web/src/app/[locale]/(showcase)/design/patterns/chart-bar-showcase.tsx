'use client';

import * as React from 'react';

import { BarChart } from '@/components/patterns/chart-bar';
import { ChartFrame } from '@/components/patterns/chart-frame';
import type { ChartStatus } from '@/components/patterns/chart.types';
import { Currency } from '@/components/patterns/currency';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// Daily net profit across a week — two loss days (negative → red bars) exercise
// the per-bar semantic coloring. `prev` is last week's same-day net for the
// grouped "Dün/Geçen hafta" comparison bar.
const DAILY_NET = [
  { day: 'Pzt', net: 420, prev: 380 },
  { day: 'Sal', net: -120, prev: 90 },
  { day: 'Çar', net: 260, prev: 310 },
  { day: 'Per', net: 540, prev: 470 },
  { day: 'Cum', net: 680, prev: 620 },
  { day: 'Cmt', net: -80, prev: 140 },
  { day: 'Paz', net: 510, prev: 560 },
] as const;

const WEEK_NET = 2210;
const LAST_SYNC = new Date('2026-06-01T18:07:00Z');

const STATUS_OPTIONS = [
  { value: 'ready', label: 'Dolu' },
  { value: 'loading', label: 'Yükleniyor' },
  { value: 'empty', label: 'Boş' },
  { value: 'error', label: 'Hata' },
] as const;

const PERIODS = [
  { value: '7d', label: '7G' },
  { value: '30d', label: '30G' },
  { value: '90d', label: '90G' },
] as const;

/** Primary demo: daily net P&L (semantic per-bar sign) + optional comparison. */
export function ChartBarShowcase(): React.ReactElement {
  const [status, setStatus] = React.useState<ChartStatus>('ready');
  const [period, setPeriod] = React.useState<string>('7d');
  const [compare, setCompare] = React.useState<boolean>(false);

  const data = status === 'ready' ? DAILY_NET : [];
  const comparing = compare && status === 'ready';

  return (
    <div className="gap-md flex flex-col">
      <div className="gap-lg flex flex-wrap items-center">
        <ToggleGroup
          type="single"
          value={status}
          onValueChange={(next) => {
            const option = STATUS_OPTIONS.find((candidate) => candidate.value === next);
            if (option) setStatus(option.value);
          }}
          size="sm"
          aria-label="Grafik durumu"
        >
          {STATUS_OPTIONS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="gap-xs flex items-center">
          <Switch id="bar-compare" checked={compare} onCheckedChange={setCompare} />
          <Label htmlFor="bar-compare" className="text-muted-foreground">
            Geçen haftayla karşılaştır
          </Label>
        </div>
      </div>

      <ChartFrame
        title="Bu Hafta Net Kâr"
        value={<Currency value={WEEK_NET} />}
        delta={comparing ? { percent: 6, goodDirection: 'up' } : undefined}
        context={comparing ? 'Geçen haftadan +₺130 · 2 zarar günü' : undefined}
        legend={
          comparing
            ? [
                {
                  label: 'Bu hafta',
                  value: <Currency value={2210} />,
                  swatch: 'var(--color-chart-positive)',
                },
                {
                  label: 'Geçen hafta',
                  value: <Currency value={2570} />,
                  swatch: 'var(--color-muted-foreground)',
                  reference: true,
                },
              ]
            : undefined
        }
        liveBadge
        lastSyncedAt={LAST_SYNC}
        source={{ platform: 'TRENDYOL', store: 'Ana Mağaza' }}
        status={status}
        chartKind="bar"
        onRetry={() => setStatus('ready')}
        period={{ value: period, options: PERIODS, onValueChange: setPeriod }}
      >
        <BarChart
          data={data}
          xKey="day"
          series={{ key: 'net', label: 'Bu hafta', format: 'currency' }}
          comparison={
            compare ? { key: 'prev', label: 'Geçen hafta', format: 'currency' } : undefined
          }
        />
      </ChartFrame>
    </div>
  );
}

// Profit by category — `colorMode="categorical"` paints each bar from the
// qualitative palette. A breakdown, not a P&L, so no zero baseline drama.
const CATEGORY_PROFIT = [
  { category: 'Elektronik', profit: 1840 },
  { category: 'Giyim', profit: 1260 },
  { category: 'Ev & Yaşam', profit: 920 },
  { category: 'Kozmetik', profit: 740 },
  { category: 'Kitap', profit: 380 },
] as const;

/** Reuse demo: categorical breakdown (palette per bar). */
export function ChartBarCategoricalShowcase(): React.ReactElement {
  return (
    <ChartFrame
      title="Kategoriye Göre Net Kâr — bu ay"
      value={<Currency value={5140} />}
      source={{ platform: 'TRENDYOL', store: 'Ana Mağaza' }}
    >
      <BarChart
        data={CATEGORY_PROFIT}
        xKey="category"
        series={{ key: 'profit', label: 'Net Kâr', format: 'currency' }}
        colorMode="categorical"
      />
    </ChartFrame>
  );
}

// Daily order count — `colorMode="brand"`: one brand color, neutral metric.
const DAILY_ORDERS = [
  { day: 'Pzt', orders: 42 },
  { day: 'Sal', orders: 51 },
  { day: 'Çar', orders: 38 },
  { day: 'Per', orders: 64 },
  { day: 'Cum', orders: 72 },
  { day: 'Cmt', orders: 95 },
  { day: 'Paz', orders: 88 },
] as const;

/** Reuse demo: a neutral count in brand mode. */
export function ChartBarBrandShowcase(): React.ReactElement {
  return (
    <ChartFrame
      title="Günlük Sipariş Adedi — son 7 gün"
      value={450}
      source={{ platform: 'TRENDYOL', store: 'Ana Mağaza' }}
    >
      <BarChart
        data={DAILY_ORDERS}
        xKey="day"
        series={{ key: 'orders', label: 'Sipariş', format: 'number' }}
        colorMode="brand"
      />
    </ChartFrame>
  );
}

// Stacked composition — each day's gross splits into net profit + commission +
// shipping. `series` is an ARRAY, so the segments stack as rounded pills with a
// bottom legend mapping color → part.
const COMPOSITION = [
  { day: 'Pzt', netKar: 420, komisyon: 185, kargo: 95 },
  { day: 'Sal', netKar: 360, komisyon: 160, kargo: 80 },
  { day: 'Çar', netKar: 510, komisyon: 220, kargo: 110 },
  { day: 'Per', netKar: 540, komisyon: 230, kargo: 120 },
  { day: 'Cum', netKar: 680, komisyon: 290, kargo: 140 },
  { day: 'Cmt', netKar: 720, komisyon: 300, kargo: 150 },
  { day: 'Paz', netKar: 560, komisyon: 240, kargo: 120 },
] as const;

const COMPOSITION_SERIES = [
  { key: 'netKar', label: 'Net Kâr', format: 'currency' as const },
  { key: 'komisyon', label: 'Komisyon', format: 'currency' as const },
  { key: 'kargo', label: 'Kargo', format: 'currency' as const },
];

/** Stacked demo: daily gross composition (rounded pill segments + legend). */
export function ChartBarStackedShowcase(): React.ReactElement {
  return (
    <ChartFrame
      title="Günlük Gelir Dağılımı — bu hafta"
      value={<Currency value={6230} />}
      source={{ platform: 'TRENDYOL', store: 'Ana Mağaza' }}
    >
      <BarChart data={COMPOSITION} xKey="day" series={COMPOSITION_SERIES} />
    </ChartFrame>
  );
}
