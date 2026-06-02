'use client';

import * as React from 'react';

import { ChartFrame } from '@/components/patterns/chart-frame';
import { LineChart } from '@/components/patterns/chart-line';
import type { ChartColorMode, ChartStatus } from '@/components/patterns/chart.types';
import { Currency } from '@/components/patterns/currency';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// Mock "today's cumulative net profit": dips negative in the morning (returns /
// refund costs) then climbs into profit — exercises the zero-split. `prev` is
// yesterday's full-day curve for the comparison line; today's `net` stops at the
// current hour (21:00) while `prev` runs to 23:00, so the leading edge reads as
// "today, still in progress" against yesterday's complete day.
const TODAY_NET = [
  { hour: '00:00', net: 0, prev: 0 },
  { hour: '02:00', net: -40, prev: -25 },
  { hour: '04:00', net: -90, prev: -55 },
  { hour: '06:00', net: -120, prev: -70 },
  { hour: '08:00', net: -30, prev: 20 },
  { hour: '09:00', net: 60, prev: 120 },
  { hour: '10:00', net: 262, prev: 240 },
  { hour: '12:00', net: 262, prev: 300 },
  { hour: '14:00', net: 355, prev: 410 },
  { hour: '16:00', net: 355, prev: 470 },
  { hour: '18:00', net: 355, prev: 540 },
  { hour: '19:00', net: 581, prev: 600 },
  { hour: '20:00', net: 644, prev: 660 },
  { hour: '21:00', net: 644, prev: 690 },
  { hour: '22:00', prev: 715 },
  { hour: '23:00', prev: 730 },
] as const;

// Neutral metric (order count) for the brand / categorical color modes — no +/-
// meaning, so no zero-split and no comparison story.
const ORDERS_7D = [
  { day: 'Pzt', orders: 42 },
  { day: 'Sal', orders: 51 },
  { day: 'Çar', orders: 38 },
  { day: 'Per', orders: 64 },
  { day: 'Cum', orders: 72 },
  { day: 'Cmt', orders: 95 },
  { day: 'Paz', orders: 88 },
] as const;

// Deterministic ISO string (not Date.now) so SSR and client agree.
const LAST_SYNC = new Date('2026-06-01T18:07:00Z');
const NET_TODAY = 644;
const ORDERS_TOTAL = 450;

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
  { value: 'today', label: 'Bugün' },
  { value: '7d', label: '7G' },
  { value: '30d', label: '30G' },
] as const;

/**
 * Interactive P&L demo + the colorMode dimension folded into one control strip.
 * `semantic` (default) plots today's cumulative net profit with the zero-split,
 * the live-edge dot, and an optional "Dün ile karşılaştır" reveal (delta chip +
 * context sub-line + inline legend). Switching to `brand` / `categorical` reuses
 * the SAME LineChart for a neutral metric (order count) — no zero-split, no
 * comparison story — proving the component spans P&L and non-P&L charts. Status
 * and period stay component-owned (live, interactive).
 */
export function ChartLineShowcase(): React.ReactElement {
  const [status, setStatus] = React.useState<ChartStatus>('ready');
  const [colorMode, setColorMode] = React.useState<ChartColorMode>('semantic');
  const [period, setPeriod] = React.useState<string>('today');
  const [compare, setCompare] = React.useState<boolean>(false);

  const isSemantic = colorMode === 'semantic';
  // Comparison is intrinsic to the P&L narrative; a neutral count has no
  // period-over-period story, so the reveal only exists in semantic mode.
  const comparing = compare && isSemantic && status === 'ready';

  // The plot renders its real (empty) axes for non-ready states; ChartFrame
  // overlays the loading shimmer / empty hint / error on top.
  const ready = status === 'ready';

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
            <Switch id="chart-compare" checked={compare} onCheckedChange={setCompare} />
            <Label htmlFor="chart-compare" className="text-muted-foreground">
              Dün ile karşılaştır
            </Label>
          </div>
        ) : null}
      </div>

      {isSemantic ? (
        <ChartFrame
          title="Bugünkü Net Kâr"
          value={<Currency value={NET_TODAY} />}
          delta={comparing ? { percent: -7, goodDirection: 'up' } : undefined}
          context={comparing ? 'Dün aynı saatte ₺690 · ₺46 geride' : undefined}
          legend={
            comparing
              ? [
                  {
                    label: 'Bugün',
                    value: <Currency value={644} />,
                    swatch: 'var(--color-chart-positive)',
                  },
                  {
                    label: 'Dün',
                    value: <Currency value={690} />,
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
          onRetry={() => setStatus('ready')}
          period={{ value: period, options: PERIODS, onValueChange: setPeriod }}
        >
          <LineChart
            data={ready ? TODAY_NET : []}
            xKey="hour"
            series={{ key: 'net', label: 'Bugün', format: 'currency' }}
            comparison={comparing ? { key: 'prev', label: 'Dün', format: 'currency' } : undefined}
            colorMode="semantic"
            liveDot
          />
        </ChartFrame>
      ) : (
        <ChartFrame
          title="Sipariş Adedi — son 7 gün"
          value={ORDERS_TOTAL}
          lastSyncedAt={LAST_SYNC}
          source={{ platform: 'TRENDYOL', store: 'Ana Mağaza' }}
          status={status}
          onRetry={() => setStatus('ready')}
          period={{ value: period, options: PERIODS, onValueChange: setPeriod }}
        >
          <LineChart
            data={ready ? ORDERS_7D : []}
            xKey="day"
            series={{ key: 'orders', label: 'Sipariş', format: 'number' }}
            colorMode={colorMode}
          />
        </ChartFrame>
      )}
    </div>
  );
}

// One card, several metrics: header tabs swap the headline value + the plotted
// series + its color mode. Net Kâr is P&L (semantic zero-split); Ciro / Sipariş
// are neutral (brand). Uses ChartFrame's `metricTabs`.
const NET_SERIES = [0, -40, -90, -120, -30, 60, 262, 262, 355, 355, 355, 581, 644, 644].map(
  (v, i) => ({ hour: TODAY_NET[i].hour, v }),
);
const CIRO_SERIES = [
  0, 180, 420, 560, 720, 980, 1340, 1480, 1820, 2080, 2360, 2560, 2740, 2840,
].map((v, i) => ({ hour: TODAY_NET[i].hour, v }));
const SIPARIS_SERIES = [0, 4, 9, 14, 22, 38, 64, 72, 95, 108, 122, 131, 138, 142].map((v, i) => ({
  hour: TODAY_NET[i].hour,
  v,
}));

const METRICS = [
  {
    value: 'netKar',
    label: 'Net Kâr',
    headline: 644,
    format: 'currency' as const,
    colorMode: 'semantic' as const,
    delta: 14,
    data: NET_SERIES,
  },
  {
    value: 'ciro',
    label: 'Ciro',
    headline: 2840,
    format: 'currency' as const,
    colorMode: 'brand' as const,
    delta: 9,
    data: CIRO_SERIES,
  },
  {
    value: 'siparis',
    label: 'Sipariş',
    headline: 142,
    format: 'number' as const,
    colorMode: 'brand' as const,
    delta: 12,
    data: SIPARIS_SERIES,
  },
] as const;

/** Metric-switcher demo: one card serving several metrics via header tabs. */
export function ChartLineMetricShowcase(): React.ReactElement {
  const [selected, setSelected] = React.useState<string>('netKar');
  const [period, setPeriod] = React.useState<string>('today');
  const metric = METRICS.find((candidate) => candidate.value === selected) ?? METRICS[0];

  return (
    <ChartFrame
      title={metric.label}
      metricTabs={{
        value: selected,
        options: METRICS.map((item) => ({ value: item.value, label: item.label })),
        onValueChange: setSelected,
      }}
      value={metric.format === 'currency' ? <Currency value={metric.headline} /> : metric.headline}
      delta={{ percent: metric.delta, goodDirection: 'up' }}
      liveBadge
      lastSyncedAt={LAST_SYNC}
      source={{ platform: 'TRENDYOL', store: 'Ana Mağaza' }}
      period={{ value: period, options: PERIODS, onValueChange: setPeriod }}
    >
      <LineChart
        data={metric.data}
        xKey="hour"
        series={{ key: 'v', label: metric.label, format: metric.format }}
        colorMode={metric.colorMode}
        liveDot
      />
    </ChartFrame>
  );
}
