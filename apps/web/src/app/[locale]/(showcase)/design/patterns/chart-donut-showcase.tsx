'use client';

import * as React from 'react';

import { DonutChart, type DonutDatum } from '@/components/patterns/chart-donut';
import { ChartFrame } from '@/components/patterns/chart-frame';
import type { ChartStatus } from '@/components/patterns/chart.types';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// Expense breakdown — where the month's deductions went. The center total is the
// headline (no separate ChartFrame value), the legend reads value + share.
const EXPENSE: readonly DonutDatum[] = [
  { label: 'Komisyon', value: 2930 },
  { label: 'Kargo', value: 1180 },
  { label: 'Reklam', value: 640 },
  { label: 'Hizmet Bedeli', value: 420 },
  { label: 'İade', value: 310 },
];

const LAST_SYNC = new Date('2026-06-01T18:07:00Z');

const STATUS_OPTIONS = [
  { value: 'ready', label: 'Dolu' },
  { value: 'loading', label: 'Yükleniyor' },
  { value: 'empty', label: 'Boş' },
  { value: 'error', label: 'Hata' },
] as const;

/** Primary demo: an expense breakdown with the four states. */
export function ChartDonutShowcase(): React.ReactElement {
  const [status, setStatus] = React.useState<ChartStatus>('ready');
  const data = status === 'ready' ? EXPENSE : [];

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
      >
        {STATUS_OPTIONS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <ChartFrame
        title="Gider Dağılımı — bu ay"
        source={{ platform: 'TRENDYOL', store: 'Ana Mağaza' }}
        lastSyncedAt={LAST_SYNC}
        status={status}
        chartKind="donut"
        onRetry={() => setStatus('ready')}
      >
        <DonutChart data={data} centerLabel="Toplam Gider" ariaLabel="Gider dağılımı" />
      </ChartFrame>
    </div>
  );
}

// Revenue share across marketplaces — a cross-marketplace roll-up, so the footer
// source is combined (Trendyol + Hepsiburada stores).
const MARKETPLACE_SHARE: readonly DonutDatum[] = [
  { label: 'Trendyol', value: 8400 },
  { label: 'Hepsiburada', value: 5200 },
  { label: 'Amazon', value: 2100 },
  { label: 'N11', value: 1300 },
];

/** Reuse demo: marketplace revenue share (cross-marketplace footer source). */
export function ChartDonutShareShowcase(): React.ReactElement {
  return (
    <ChartFrame
      title="Pazaryeri Payı — bu ay"
      source={[
        { platform: 'TRENDYOL', store: 'Ana Mağaza' },
        { platform: 'HEPSIBURADA', store: 'HB Mağaza' },
      ]}
    >
      <DonutChart data={MARKETPLACE_SHARE} centerLabel="Toplam Ciro" ariaLabel="Pazaryeri payı" />
    </ChartFrame>
  );
}
