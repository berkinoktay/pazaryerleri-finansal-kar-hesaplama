'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatPercent } from '@pazarsync/utils';

import { AnimatedNumber } from '@/components/patterns/animated-number';
import { Currency } from '@/components/patterns/currency';
import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';

import type { OrderSummary } from '../api/get-orders-summary.api';

interface OrdersKpiStripProps {
  summary?: OrderSummary;
  loading?: boolean;
}

/** Average sale margin — null (no scored orders) reads as an em-dash, not 0%. */
function renderAvgMargin(summary: OrderSummary): React.ReactNode {
  if (summary.avgMarginPct === null) {
    return '—';
  }
  return <AnimatedNumber value={Number(summary.avgMarginPct)} format={formatPercent} />;
}

/**
 * Four headline KPIs docked into the orders PageHeader summary slot, scoped to
 * the active filters/date range (same query shape as the list). Money +
 * percentages come from the backend summary endpoint; this component only
 * renders (no derivation). Rendered as a bare StatStrip so the framed header
 * owns the surface; loading shows skeletons while keeping the real labels.
 *   Toplam Ciro · Net Kâr · Ort. Marj · Zarar Eden Sipariş %
 */
export function OrdersKpiStrip({
  summary,
  loading = false,
}: OrdersKpiStripProps): React.ReactElement {
  const t = useTranslations('ordersPage.kpis');
  const tCommon = useTranslations('common');

  const items: StatStripItem[] = [
    {
      label: t('revenue'),
      value: summary ? <Currency value={summary.totalRevenueGross} animate /> : null,
    },
    {
      label: t('netProfit'),
      value: summary ? <Currency value={summary.netProfitGross} animate /> : null,
    },
    {
      label: t('avgMargin'),
      value: summary ? renderAvgMargin(summary) : null,
    },
    {
      label: t('lossRate'),
      value: summary ? (
        <AnimatedNumber value={Number(summary.lossOrderRate.pct)} format={formatPercent} />
      ) : null,
      context: summary
        ? t('lossCount', {
            count: summary.lossOrderRate.lossCount,
            total: summary.lossOrderRate.totalCount,
          })
        : undefined,
    },
  ];

  return (
    <StatStrip
      surface="bare"
      size="md"
      items={items}
      loading={loading}
      loadingLabel={tCommon('loading')}
    />
  );
}
