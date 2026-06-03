'use client';

import * as React from 'react';

import { ChartFrame, type ChartSource } from '@/components/patterns/chart-frame';
import { RankingChart, type RankingDatum } from '@/components/patterns/chart-ranking';
import type { ChartColorMode, ChartStatus } from '@/components/patterns/chart.types';
import { Currency } from '@/components/patterns/currency';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// Most-profitable categories this month — all positive, so `brand` mode reads
// best (one color, the bar LENGTH carries the ranking). 1.840 + 1.260 + 920 +
// 740 + 380.
const TOP_CATEGORY: readonly RankingDatum[] = [
  { label: 'Elektronik', value: 1840 },
  { label: 'Giyim', value: 1260 },
  { label: 'Ev & Yaşam', value: 920 },
  { label: 'Kozmetik', value: 740 },
  { label: 'Kitap', value: 380 },
];

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

// Revenue by marketplace — a breakdown, so `categorical` paints each row from the
// qualitative palette. 8.400 + 5.200 + 2.100 + 1.300 = 17.000.
const MARKETPLACE_SHARE: readonly RankingDatum[] = [
  { label: 'Trendyol', value: 8400 },
  { label: 'Hepsiburada', value: 5200 },
  { label: 'Amazon', value: 2100 },
  { label: 'N11', value: 1300 },
];

const LAST_SYNC = new Date('2026-06-01T18:07:00Z');

const STATUS_OPTIONS = [
  { value: 'ready', label: 'Dolu' },
  { value: 'loading', label: 'Yükleniyor' },
  { value: 'empty', label: 'Boş' },
  { value: 'error', label: 'Hata' },
] as const;

const COLOR_MODES = [
  { value: 'brand', label: 'brand' },
  { value: 'semantic', label: 'semantic' },
  { value: 'categorical', label: 'categorical' },
] as const;

const LABEL_MODES = [
  { value: 'outside', label: 'Etiket dışarıda' },
  { value: 'inside', label: 'Etiket içeride' },
] as const;

type LabelMode = (typeof LABEL_MODES)[number]['value'];

// Each color mode tells its own ranking story (and needs its own dataset — the
// semantic zero-divider only appears with signed data), so the frame's title /
// headline / source follow the mode rather than being hard-coded.
const MODE_FIXTURE: Record<
  ChartColorMode,
  {
    title: string;
    total: number;
    context?: string;
    data: readonly RankingDatum[];
    source: ChartSource;
    ariaLabel: string;
  }
> = {
  brand: {
    title: 'En Kârlı Kategoriler — bu ay',
    total: 5140,
    data: TOP_CATEGORY,
    source: { platform: 'TRENDYOL', store: 'Ana Mağaza' },
    ariaLabel: 'En kârlı kategoriler',
  },
  semantic: {
    title: 'Ürün Kâr / Zarar — bu hafta',
    total: 2360,
    context: '2 ürün zarar ediyor',
    data: PRODUCT_PNL,
    source: { platform: 'TRENDYOL', store: 'Ana Mağaza' },
    ariaLabel: 'Ürün kâr/zarar',
  },
  categorical: {
    title: 'Pazaryeri Cirosu — bu ay',
    total: 17000,
    data: MARKETPLACE_SHARE,
    source: [
      { platform: 'TRENDYOL', store: 'Ana Mağaza' },
      { platform: 'HEPSIBURADA', store: 'HB Mağaza' },
    ],
    ariaLabel: 'Pazaryeri cirosu',
  },
};

/**
 * The single Ranking demo — colorMode, label placement, and the four states all
 * fold into one control strip. `brand` ranks all-positive categories (length is
 * the signal, value axis + gutter); `semantic` switches to a signed product P&L
 * dataset so loss rows extend left of the zero divider (kâr yeşil / zarar
 * kırmızı); `categorical` paints a marketplace breakdown from the palette. The
 * "Etiket dışarıda/içeride" toggle moves the label to a left gutter vs. inside
 * the bar; status drives the content-height row skeleton.
 */
export function ChartRankingShowcase(): React.ReactElement {
  const [status, setStatus] = React.useState<ChartStatus>('ready');
  const [colorMode, setColorMode] = React.useState<ChartColorMode>('brand');
  const [labelMode, setLabelMode] = React.useState<LabelMode>('outside');

  const fixture = MODE_FIXTURE[colorMode];
  const data = status === 'ready' ? fixture.data : [];

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
        title={fixture.title}
        value={<Currency value={fixture.total} />}
        context={fixture.context}
        source={fixture.source}
        lastSyncedAt={LAST_SYNC}
        status={status}
        chartKind="ranking"
        height="auto"
        onRetry={() => setStatus('ready')}
      >
        <RankingChart
          data={data}
          colorMode={colorMode}
          labelMode={labelMode}
          ariaLabel={fixture.ariaLabel}
        />
      </ChartFrame>
    </div>
  );
}
