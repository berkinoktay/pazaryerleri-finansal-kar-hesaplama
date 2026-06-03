'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ChartFrame } from '@/components/patterns/chart-frame';
import { RankingChart, type RankingDatum } from '@/components/patterns/chart-ranking';
import type { ChartStatus } from '@/components/patterns/chart.types';

import { useLiveTopProducts } from '../hooks/use-live-top-products';

interface LiveTopProductsProps {
  orgId: string;
  storeId: string;
}

/**
 * Today's best sellers as a horizontal ranking — the chart-kit's "which one
 * wins" archetype. Bars are sized by revenue (always present, unlike profit
 * which is null while a contributing order is cost-missing) and sorted
 * descending, so the seller reads the day's leaders at a glance. ChartFrame owns
 * the loading / empty / error states (a ranking-shaped skeleton + empty frame),
 * so this stays a pure plot.
 */
export function LiveTopProducts({ orgId, storeId }: LiveTopProductsProps): React.ReactElement {
  const t = useTranslations('livePerformance.topProducts');
  const query = useLiveTopProducts(orgId, storeId);
  const rows = query.data?.data ?? [];

  const status: ChartStatus = query.isPending
    ? 'loading'
    : query.isError
      ? 'error'
      : rows.length === 0
        ? 'empty'
        : 'ready';

  const data: RankingDatum[] = rows.map((row) => ({
    label: row.productName,
    value: Number(row.revenue),
  }));

  return (
    <ChartFrame
      title={t('title')}
      status={status}
      chartKind="ranking"
      height="auto"
      emptyHint={t('emptyTitle')}
      onRetry={() => void query.refetch()}
    >
      <RankingChart data={data} colorMode="brand" format="currency" ariaLabel={t('title')} />
    </ChartFrame>
  );
}
