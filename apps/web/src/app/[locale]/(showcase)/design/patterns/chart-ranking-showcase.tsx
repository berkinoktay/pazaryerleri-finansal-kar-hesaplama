'use client';

import * as React from 'react';

import { ChartFrame } from '@/components/patterns/chart-frame';
import { RankingChart, type RankingDatum } from '@/components/patterns/chart-ranking';
import type { ChartStatus } from '@/components/patterns/chart.types';
import { Currency } from '@/components/patterns/currency';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// Most-profitable categories this month — all positive, so `brand` mode: one
// color, the bar LENGTH carries the ranking. 1.840 + 1.260 + 920 + 740 + 380.
const TOP_CATEGORY: readonly RankingDatum[] = [
  { label: 'Elektronik', value: 1840 },
  { label: 'Giyim', value: 1260 },
  { label: 'Ev & Yaşam', value: 920 },
  { label: 'Kozmetik', value: 740 },
  { label: 'Kitap', value: 380 },
];

const LAST_SYNC = new Date('2026-06-01T18:07:00Z');

const STATUS_OPTIONS = [
  { value: 'ready', label: 'Dolu' },
  { value: 'loading', label: 'Yükleniyor' },
  { value: 'empty', label: 'Boş' },
  { value: 'error', label: 'Hata' },
] as const;

const LABEL_MODES = [
  { value: 'outside', label: 'Etiket dışarıda' },
  { value: 'inside', label: 'Etiket içeride' },
] as const;

type LabelMode = (typeof LABEL_MODES)[number]['value'];

/** Primary demo: a brand-mode ranking with a label-mode toggle + the four states. */
export function ChartRankingShowcase(): React.ReactElement {
  const [status, setStatus] = React.useState<ChartStatus>('ready');
  const [labelMode, setLabelMode] = React.useState<LabelMode>('outside');
  const data = status === 'ready' ? TOP_CATEGORY : [];

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
          <Label className="text-muted-foreground">Etiket</Label>
          <ToggleGroup
            type="single"
            value={labelMode}
            onValueChange={(next) => {
              const option = LABEL_MODES.find((candidate) => candidate.value === next);
              if (option) setLabelMode(option.value);
            }}
            size="sm"
            aria-label="Etiket yerleşimi"
          >
            {LABEL_MODES.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <ChartFrame
        title="En Kârlı Kategoriler — bu ay"
        value={<Currency value={5140} />}
        source={{ platform: 'TRENDYOL', store: 'Ana Mağaza' }}
        lastSyncedAt={LAST_SYNC}
        status={status}
        chartKind="ranking"
        height="auto"
        onRetry={() => setStatus('ready')}
      >
        <RankingChart data={data} labelMode={labelMode} ariaLabel="En kârlı kategoriler" />
      </ChartFrame>
    </div>
  );
}

// Product P&L — the tail loses money, so `semantic` colors each row by its sign:
// profitable rows extend right (green), loss rows extend left of the zero divider
// (red). 1.840 + 920 + 240 − 180 − 460 = 2.360.
const PRODUCT_PNL: readonly RankingDatum[] = [
  { label: 'Kulaklık', value: 1840 },
  { label: 'Ayakkabı', value: 920 },
  { label: 'Mont', value: 240 },
  { label: 'Kablo', value: -180 },
  { label: 'Kılıf', value: -460 },
];

/** Reuse demo: a profit ranking where the tail is in the red (semantic). */
export function ChartRankingPnlShowcase(): React.ReactElement {
  return (
    <ChartFrame
      title="Ürün Kâr / Zarar — bu hafta"
      value={<Currency value={2360} />}
      context="2 ürün zarar ediyor"
      source={{ platform: 'TRENDYOL', store: 'Ana Mağaza' }}
      height="auto"
    >
      <RankingChart data={PRODUCT_PNL} colorMode="semantic" ariaLabel="Ürün kâr/zarar" />
    </ChartFrame>
  );
}

// Revenue by marketplace — a breakdown, so `categorical` paints each row from the
// qualitative palette. 8.400 + 5.200 + 2.100 + 1.300 = 17.000.
const MARKETPLACE_SHARE: readonly RankingDatum[] = [
  { label: 'Trendyol', value: 8400 },
  { label: 'Hepsiburada', value: 5200 },
  { label: 'Amazon', value: 2100 },
  { label: 'N11', value: 1300 },
];

/** Reuse demo: a marketplace revenue breakdown (categorical palette). */
export function ChartRankingShareShowcase(): React.ReactElement {
  return (
    <ChartFrame
      title="Pazaryeri Cirosu — bu ay"
      value={<Currency value={17000} />}
      source={[
        { platform: 'TRENDYOL', store: 'Ana Mağaza' },
        { platform: 'HEPSIBURADA', store: 'HB Mağaza' },
      ]}
      height="auto"
    >
      <RankingChart data={MARKETPLACE_SHARE} colorMode="categorical" ariaLabel="Pazaryeri cirosu" />
    </ChartFrame>
  );
}
