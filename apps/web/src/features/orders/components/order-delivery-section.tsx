'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

import { type OrderDetail } from '../api/get-order.api';

/**
 * Delivery performance strip: agreed vs actual delivery date + an on-time / late
 * badge. All three fields already ride on OrderDetail (deliveredOnTime is
 * backend-derived). Renders nothing when none are present (no noise).
 */
export function OrderDeliverySection({ order }: { order: OrderDetail }): React.ReactElement | null {
  const t = useTranslations('orderDetail.delivery');
  const formatter = useFormatter();

  const hasAnything =
    order.agreedDeliveryDate !== null ||
    order.actualDeliveryDate !== null ||
    order.deliveredOnTime !== null;
  if (!hasAnything) return null;

  return (
    <Card>
      <CardContent className="gap-lg py-md flex flex-wrap items-center">
        {order.agreedDeliveryDate !== null ? (
          <div className="gap-3xs flex flex-col">
            <span className="text-2xs text-muted-foreground">{t('agreed')}</span>
            <span className="text-sm tabular-nums">
              {formatter.dateTime(new Date(order.agreedDeliveryDate), 'short')}
            </span>
          </div>
        ) : null}
        {order.actualDeliveryDate !== null ? (
          <div className="gap-3xs flex flex-col">
            <span className="text-2xs text-muted-foreground">{t('actual')}</span>
            <span className="text-sm tabular-nums">
              {formatter.dateTime(new Date(order.actualDeliveryDate), 'short')}
            </span>
          </div>
        ) : null}
        {order.deliveredOnTime !== null ? (
          <Badge tone={order.deliveredOnTime ? 'success' : 'destructive'} size="sm">
            {t(order.deliveredOnTime ? 'onTime' : 'late')}
          </Badge>
        ) : null}
      </CardContent>
    </Card>
  );
}
