'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { Currency } from '@/components/patterns/currency';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { ProductMetrics } from '@/features/dashboard/api/dashboard.api';

export interface ProductMetricsCardProps {
  data: ProductMetrics | undefined;
}

export function ProductMetricsCard({ data }: ProductMetricsCardProps): React.ReactElement {
  const t = useTranslations();
  return (
    <Card className="gap-md p-lg flex flex-col">
      <h2 className="text-foreground text-base font-semibold">
        {t('dashboard.section.productMetrics')}
      </h2>
      {data ? (
        <ul className="gap-2xs flex flex-col text-sm">
          <Row label={t('dashboard.product.netSales')} value={data.netSales.toString()} />
          <Separator />
          <Row
            label={t('dashboard.product.avgProfit')}
            value={<Currency value={data.avgProfit} />}
          />
          <Separator />
          <Row
            label={t('dashboard.product.avgShipping')}
            value={<Currency value={data.avgShippingCost} />}
          />
          <Separator />
          <Row
            label={t('dashboard.product.avgCommission')}
            value={`%${data.avgCommissionPercent.toFixed(2)}`}
          />
          <Separator />
          <Row
            label={t('dashboard.product.avgDiscount')}
            value={`%${data.avgDiscountPercent.toFixed(2)}`}
          />
        </ul>
      ) : (
        <div className="text-muted-foreground text-center text-sm">—</div>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-semibold tabular-nums">{value}</span>
    </li>
  );
}
