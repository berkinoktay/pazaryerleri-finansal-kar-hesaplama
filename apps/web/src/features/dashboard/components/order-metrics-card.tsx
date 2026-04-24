'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { Currency } from '@/components/patterns/currency';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { OrderMetrics } from '@/features/dashboard/api/dashboard.api';

export interface OrderMetricsCardProps {
  data: OrderMetrics | undefined;
}

export function OrderMetricsCard({ data }: OrderMetricsCardProps): React.ReactElement {
  const t = useTranslations();
  return (
    <Card className="gap-md p-lg flex flex-col">
      <h2 className="text-foreground text-base font-semibold">
        {t('dashboard.section.orderMetrics')}
      </h2>
      {data ? (
        <ul className="gap-2xs flex flex-col text-sm">
          <Row label={t('dashboard.order.count')} value={data.count.toString()} />
          <Separator />
          <Row
            label={t('dashboard.order.avgValue')}
            value={<Currency value={data.avgOrderValue} />}
          />
          <Separator />
          <Row label={t('dashboard.order.avgProfit')} value={<Currency value={data.avgProfit} />} />
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
