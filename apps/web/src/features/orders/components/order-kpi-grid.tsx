'use client';

import Decimal from 'decimal.js';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { KpiTile } from '@/components/patterns/kpi-tile';
import { Card } from '@/components/ui/card';

import { type OrderDetail } from '../api/get-order.api';

export interface OrderKpiGridProps {
  order: Pick<OrderDetail, 'saleSubtotalNet' | 'estimatedNetProfit' | 'settledNetProfit'>;
}

/**
 * 4-tile KPI strip at the top of the order detail. The first three reuse
 * the canonical KpiTile (currency). The margin tile uses the same Card
 * shell + heading hierarchy so the strip reads as a single unit, but
 * renders a percentage — the design system's KpiTile is value-kind locked
 * to currency / count, so percent is feature-local rather than forking
 * the primitive.
 */
export function OrderKpiGrid({ order }: OrderKpiGridProps): React.ReactElement {
  const t = useTranslations('orderDetail.kpis');

  const saleNet = order.saleSubtotalNet;
  const estimatedProfit = order.estimatedNetProfit;
  const settledProfit = order.settledNetProfit;
  const effectiveProfit = settledProfit ?? estimatedProfit;

  const marginPercent = computeMarginPercent(saleNet, effectiveProfit);

  return (
    <div className="gap-md grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile
        label={t('saleSubtotalNet.label')}
        value={{ kind: 'currency', amount: saleNet ?? '0' }}
        context={saleNet === null ? t('common.notAvailable') : undefined}
      />
      <KpiTile
        label={t('estimatedNetProfit.label')}
        value={{ kind: 'currency', amount: estimatedProfit ?? '0' }}
        context={estimatedProfit === null ? t('common.notAvailable') : t('estimatedNetProfit.hint')}
      />
      <KpiTile
        label={t('settledNetProfit.label')}
        value={{ kind: 'currency', amount: settledProfit ?? '0' }}
        context={
          settledProfit === null ? t('settledNetProfit.pending') : t('settledNetProfit.hint')
        }
      />
      <MarginTile
        label={t('margin.label')}
        percent={marginPercent}
        hint={
          marginPercent === null
            ? t('common.notAvailable')
            : settledProfit !== null
              ? t('margin.basisSettled')
              : t('margin.basisEstimated')
        }
      />
    </div>
  );
}

interface MarginTileProps {
  label: string;
  percent: Decimal | null;
  hint: string;
}

function MarginTile({ label, percent, hint }: MarginTileProps): React.ReactElement {
  const formatter = useFormatter();
  return (
    <Card className="gap-md p-lg flex flex-col justify-between">
      <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
        {label}
      </span>
      <div className="gap-sm flex items-baseline">
        <span
          data-tabular="true"
          className="text-foreground text-4xl font-semibold tracking-tight tabular-nums"
        >
          {percent === null ? '—' : `${formatter.number(percent.toNumber(), 'decimal')}%`}
        </span>
      </div>
      <p className="text-2xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

function computeMarginPercent(saleNet: string | null, profit: string | null): Decimal | null {
  if (saleNet === null || profit === null) return null;
  const sale = new Decimal(saleNet);
  if (sale.isZero()) return null;
  return new Decimal(profit).div(sale).mul(100).toDecimalPlaces(1);
}
