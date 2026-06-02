'use client';

import * as React from 'react';

import { ComboChart } from '@/components/patterns/chart-combo';
import { ChartFrame } from '@/components/patterns/chart-frame';
import type { ChartStatus } from '@/components/patterns/chart.types';
import { Currency } from '@/components/patterns/currency';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// Monthly revenue (bar, left ₺ axis) against profit margin % (line, right axis):
// the two scales let a rising ciro and a wobbling marj share one frame without
// the ₺ thousands flattening the 19–26% line into the baseline.
const REVENUE_MARGIN = [
  { month: 'Oca', ciro: 18400, marj: 22 },
  { month: 'Şub', ciro: 21200, marj: 19 },
  { month: 'Mar', ciro: 24600, marj: 24 },
  { month: 'Nis', ciro: 22800, marj: 21 },
  { month: 'May', ciro: 28400, marj: 26 },
  { month: 'Haz', ciro: 31200, marj: 23 },
] as const;

const LAST_SYNC = new Date('2026-06-01T18:07:00Z');

const STATUS_OPTIONS = [
  { value: 'ready', label: 'Dolu' },
  { value: 'loading', label: 'Yükleniyor' },
  { value: 'empty', label: 'Boş' },
  { value: 'error', label: 'Hata' },
] as const;

const PERIODS = [
  { value: '6m', label: '6A' },
  { value: '12m', label: '12A' },
  { value: 'ytd', label: 'Yıl' },
] as const;

const COMBO_BARS = [{ key: 'ciro', label: 'Ciro', format: 'currency' as const }];
const COMBO_LINES = [{ key: 'marj', label: 'Marj %', format: 'percent' as const }];

/** Primary demo: ciro (bars, ₺) + marj % (line, right axis) with the state toggle. */
export function ComboChartShowcase(): React.ReactElement {
  const [status, setStatus] = React.useState<ChartStatus>('ready');
  const [period, setPeriod] = React.useState<string>('6m');

  const data = status === 'ready' ? REVENUE_MARGIN : [];

  return (
    <div className="gap-md flex flex-col">
      <ToggleGroup
        type="single"
        value={status}
        onValueChange={(next) => {
          const option = STATUS_OPTIONS.find((candidate) => candidate.value === next);
          if (option) setStatus(option.value);
        }}
        size="sm"
        aria-label="Grafik durumu"
        className="self-start"
      >
        {STATUS_OPTIONS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <ChartFrame
        title="Ciro & Marj — son 6 ay"
        value={<Currency value={31200} />}
        context="Haziran · marj %23"
        lastSyncedAt={LAST_SYNC}
        source={{ platform: 'TRENDYOL', store: 'Ana Mağaza' }}
        status={status}
        chartKind="combo"
        onRetry={() => setStatus('ready')}
        period={{ value: period, options: PERIODS, onValueChange: setPeriod }}
      >
        <ComboChart data={data} xKey="month" bars={COMBO_BARS} lines={COMBO_LINES} />
      </ChartFrame>
    </div>
  );
}

// Two bar series (Trendyol + Hepsiburada ciro, grouped on the left ₺ axis) plus a
// blended margin line on the right axis — exercises grouped bars + a line + the
// combined cross-marketplace footer source.
const BY_MARKETPLACE = [
  { month: 'Mar', trendyol: 18600, hepsiburada: 6000, marj: 24 },
  { month: 'Nis', trendyol: 17400, hepsiburada: 5400, marj: 21 },
  { month: 'May', trendyol: 21800, hepsiburada: 6600, marj: 26 },
  { month: 'Haz', trendyol: 23800, hepsiburada: 7400, marj: 23 },
] as const;

const MARKETPLACE_BARS = [
  { key: 'trendyol', label: 'Trendyol', format: 'currency' as const },
  { key: 'hepsiburada', label: 'Hepsiburada', format: 'currency' as const },
];

/** Reuse demo: grouped bars (two marketplaces) + a margin line, combined source. */
export function ComboChartMarketplaceShowcase(): React.ReactElement {
  return (
    <ChartFrame
      title="Pazaryeri Cirosu & Marj — son 4 ay"
      value={<Currency value={31200} />}
      context="Haziran · birleşik ciro"
      lastSyncedAt={LAST_SYNC}
      source={[
        { platform: 'TRENDYOL', store: 'Ana Mağaza' },
        { platform: 'HEPSIBURADA', store: 'HB Mağaza' },
      ]}
      chartKind="combo"
    >
      <ComboChart data={BY_MARKETPLACE} xKey="month" bars={MARKETPLACE_BARS} lines={COMBO_LINES} />
    </ChartFrame>
  );
}
