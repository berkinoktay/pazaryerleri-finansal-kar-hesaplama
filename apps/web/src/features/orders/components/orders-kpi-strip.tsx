'use client';

import Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { formatPercent } from '@pazarsync/utils';

import { Currency } from '@/components/patterns/currency';
import { StatCard } from '@/components/patterns/stat-card';
import { StatGroup } from '@/components/patterns/stat-group';

import type { OrderSummary } from '../api/get-orders-summary.api';

interface OrdersKpiStripProps {
  summary: OrderSummary | undefined;
  status: 'ready' | 'loading' | 'error';
}

/**
 * Four headline KPIs above the orders table, scoped to the active filters/date
 * range (same query shape as the list). Money + percentages come from the
 * backend summary endpoint; this component only renders (no derivation).
 *   Toplam Ciro · Net Kâr · Ort. Marj · Zarar Eden Sipariş %
 */
export function OrdersKpiStrip({ summary, status }: OrdersKpiStripProps): React.ReactElement {
  const t = useTranslations('ordersPage.kpis');

  return (
    <StatGroup>
      <StatCard
        status={status}
        label={t('revenue')}
        value={summary ? <Currency value={summary.totalRevenueGross} /> : null}
      />
      <StatCard
        status={status}
        label={t('netProfit')}
        value={summary ? <Currency value={summary.netProfitGross} emphasis /> : null}
      />
      <StatCard
        status={status}
        label={t('avgMargin')}
        value={
          summary
            ? summary.avgMarginPct === null
              ? '—'
              : formatPercent(new Decimal(summary.avgMarginPct))
            : null
        }
      />
      <StatCard
        status={status}
        label={t('lossRate')}
        value={summary ? formatPercent(new Decimal(summary.lossOrderRate.pct)) : null}
        context={
          summary
            ? t('lossCount', {
                count: summary.lossOrderRate.lossCount,
                total: summary.lossOrderRate.totalCount,
              })
            : undefined
        }
      />
    </StatGroup>
  );
}
