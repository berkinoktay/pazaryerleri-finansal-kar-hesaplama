'use client';

import * as React from 'react';

import { BarChart } from '@/components/patterns/chart-bar';
import { ChartFrame } from '@/components/patterns/chart-frame';
import type { ChartColorMode, ChartStatus } from '@/components/patterns/chart.types';
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

// Category breakdown for brand / categorical modes — all-positive, no sign drama
// (`brand` = one color count, `categorical` = palette per bar).
const CATEGORY_PROFIT = [
  { category: 'Elektronik', profit: 1840 },
  { category: 'Giyim', profit: 1260 },
  { category: 'Ev & Yaşam', profit: 920 },
  { category: 'Kozmetik', profit: 740 },
  { category: 'Kitap', profit: 380 },
] as const;

const WEEK_NET = 2210;
const CATEGORY_TOTAL = 5140;
const LAST_SYNC = new Date('2026-06-01T18:07:00Z');

const STATUS_OPTIONS = [
  { value: 'ready', label: 'Dolu' },
  { value: 'loading', label: 'Yükleniyor' },
  { value: 'empty', label: 'Boş' },
  { value: 'error', label: 'Hata' },
] as const;

const COLOR_MODES = [
  { value: 'semantic', label: 'semantic' },
  { value: 'brand', label: 'brand' },
  { value: 'categorical', label: 'categorical' },
] as const;

const PERIODS = [
  { value: '7d', label: '7G' },
  { value: '30d', label: '30G' },
  { value: '90d', label: '90G' },
] as const;

/**
 * Primary demo: daily net P&L (semantic per-bar sign) with the colorMode
 * dimension folded into one control strip. `semantic` (default) colors each bar
 * by its OWN sign — kâr günü yeşil, zarar günü kırmızı — and unlocks the "Geçen
 * haftayla karşılaştır" grouped comparison bar (delta + context + legend).
 * Switching to `brand` / `categorical` reuses the SAME BarChart for a
 * non-P&L breakdown (kategoriye göre net kâr): one brand color, or the
 * qualitative palette per bar. Status + period stay component-owned.
 */
export function ChartBarShowcase(): React.ReactElement {
  const [status, setStatus] = React.useState<ChartStatus>('ready');
  const [colorMode, setColorMode] = React.useState<ChartColorMode>('semantic');
  const [period, setPeriod] = React.useState<string>('7d');
  const [compare, setCompare] = React.useState<boolean>(false);

  const ready = status === 'ready';
  const isSemantic = colorMode === 'semantic';
  // The grouped comparison bar belongs to the daily P&L story only.
  const comparing = compare && isSemantic && ready;

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
          <Label className="text-muted-foreground">colorMode</Label>
          <ToggleGroup
            type="single"
            value={colorMode}
            onValueChange={(next) => {
              const option = COLOR_MODES.find((candidate) => candidate.value === next);
              if (option) setColorMode(option.value);
            }}
            size="sm"
            aria-label="Renk modu"
          >
            {COLOR_MODES.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {isSemantic ? (
          <div className="gap-xs flex items-center">
            <Switch id="bar-compare" checked={compare} onCheckedChange={setCompare} />
            <Label htmlFor="bar-compare" className="text-muted-foreground">
              Geçen haftayla karşılaştır
            </Label>
          </div>
        ) : null}
      </div>

      {isSemantic ? (
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
            data={ready ? DAILY_NET : []}
            xKey="day"
            series={{ key: 'net', label: 'Bu hafta', format: 'currency' }}
            comparison={
              comparing ? { key: 'prev', label: 'Geçen hafta', format: 'currency' } : undefined
            }
            colorMode="semantic"
          />
        </ChartFrame>
      ) : (
        <ChartFrame
          title="Kategoriye Göre Net Kâr — bu ay"
          value={<Currency value={CATEGORY_TOTAL} />}
          lastSyncedAt={LAST_SYNC}
          source={{ platform: 'TRENDYOL', store: 'Ana Mağaza' }}
          status={status}
          chartKind="bar"
          onRetry={() => setStatus('ready')}
          period={{ value: period, options: PERIODS, onValueChange: setPeriod }}
        >
          <BarChart
            data={ready ? CATEGORY_PROFIT : []}
            xKey="category"
            series={{ key: 'profit', label: 'Net Kâr', format: 'currency' }}
            colorMode={colorMode}
          />
        </ChartFrame>
      )}
    </div>
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
