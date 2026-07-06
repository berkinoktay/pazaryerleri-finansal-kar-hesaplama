'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatNumber, formatPercent } from '@pazarsync/utils';

import { AnimatedNumber } from '@/components/patterns/animated-number';
import { Currency } from '@/components/patterns/currency';
import { type StatCardDelta } from '@/components/patterns/stat-card';
import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';
import type { MarginScale } from '@/lib/margin-coloring';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { marginColorStyle } from '@/lib/margin-color-style';

import type { LivePerformanceKpis } from '../api/get-live-kpis.api';
import { useLiveKpis } from '../hooks/use-live-kpis';
import { computeDeltaPercent } from '../lib/compute-delta-percent';

/** Keys available under the `livePerformance.kpis` i18n namespace. */
type KpiKey =
  | 'revenue'
  | 'orderCount'
  | 'unitsSold'
  | 'margin'
  | 'profitCostRatio'
  | 'estimateHint';

interface KpiItemDescriptor {
  key: string;
  /** i18n key under `livePerformance.kpis`. */
  labelKey: KpiKey;
  /** Value node (Currency / number / percent). Margin reads the scale for its inline color. */
  value: (k: LivePerformanceKpis, scale: MarginScale | null) => React.ReactNode;
  /** [today, yesterday] decimal strings for the delta chip. */
  deltaPair: (k: LivePerformanceKpis) => [string, string];
  /** ⓘ note key — only the profit-quality satellites explain the estimate. */
  hintKey?: KpiKey;
}

/**
 * The five satellite KPIs that orbit the hero net-profit figure in the framed
 * header. Volume (Ciro / Sipariş / Satış) reads the whole today-universe; the
 * profit-quality pair (Marj / Kâr-Maliyet) reads the costed subset only — so
 * those two carry an ⓘ "estimate" note. Net profit itself is NOT here: it is
 * the header hero, and the pending-cost gap sub-label rides with it. All read
 * "up is good"; the delta chip is omitted when yesterday was zero. The strip
 * shares one query with the hero, so its loading state drives every cell.
 */
const KPI_ITEMS: KpiItemDescriptor[] = [
  {
    key: 'revenue',
    labelKey: 'revenue',
    value: (k) => <Currency value={k.revenueToday} animate />,
    deltaPair: (k) => [k.revenueToday, k.revenueYesterday],
  },
  {
    key: 'orderCount',
    labelKey: 'orderCount',
    value: (k) => <AnimatedNumber value={k.orderCountToday} format={formatNumber} />,
    deltaPair: (k) => [String(k.orderCountToday), String(k.orderCountYesterday)],
  },
  {
    key: 'unitsSold',
    labelKey: 'unitsSold',
    value: (k) => <AnimatedNumber value={k.unitsSoldToday} format={formatNumber} />,
    deltaPair: (k) => [String(k.unitsSoldToday), String(k.unitsSoldYesterday)],
  },
  {
    key: 'margin',
    labelKey: 'margin',
    // Margin coloring: the inline style tints the value by the live margin bucket;
    // `marginColorStyle` returns undefined (colorless) when coloring is off, so the
    // OFF state renders exactly as it did before the margin-coloring feature.
    value: (k, scale) => (
      <AnimatedNumber
        value={Number(k.marginToday)}
        format={formatPercent}
        style={marginColorStyle(k.marginToday, scale)}
      />
    ),
    deltaPair: (k) => [k.marginToday, k.marginYesterday],
    hintKey: 'estimateHint',
  },
  {
    key: 'profitCostRatio',
    labelKey: 'profitCostRatio',
    value: (k) => <AnimatedNumber value={Number(k.profitCostRatioToday)} format={formatPercent} />,
    deltaPair: (k) => [k.profitCostRatioToday, k.profitCostRatioYesterday],
    hintKey: 'estimateHint',
  },
];

/**
 * The satellite KPI strip docked in the framed live-performance header's
 * `summary` slot. Renders as a `bare` `StatStrip` (the framed PageHeader owns
 * the surface + entrance). Net profit is the header hero, so it is deliberately
 * absent here. Owns its own `useLiveKpis` query — React Query dedupes it with
 * the page client's identical query, so no prop drilling. The page client omits
 * this slot on error, so the strip only ever renders in the loading or ready state.
 */
export function LiveKpiRow({
  orgId,
  storeId,
}: {
  orgId: string;
  storeId: string;
}): React.ReactElement {
  const t = useTranslations('livePerformance.kpis');
  const tCommon = useTranslations('common');
  const query = useLiveKpis(orgId, storeId);
  const kpis = query.data;
  // Margin coloring scale — read once for the margin satellite.
  const scale = useMarginColoring();

  const items: StatStripItem[] = KPI_ITEMS.map((card) => {
    const pair = kpis ? card.deltaPair(kpis) : undefined;
    return {
      label: t(card.labelKey),
      value: kpis ? card.value(kpis, scale) : null,
      hint: card.hintKey ? t(card.hintKey) : undefined,
      delta: pair ? deltaProp(pair[0], pair[1]) : undefined,
    };
  });

  return (
    <StatStrip
      surface="bare"
      size="sm"
      items={items}
      loading={query.isPending}
      loadingLabel={tCommon('loading')}
    />
  );
}

/**
 * Build the StatStrip delta, or `undefined` when no relative change exists
 * (yesterday was zero). All five satellites read "higher is better" → goodDirection up.
 */
function deltaProp(today: string, yesterday: string): StatCardDelta | undefined {
  const percent = computeDeltaPercent(today, yesterday);
  return percent === null ? undefined : { percent, goodDirection: 'up' };
}
