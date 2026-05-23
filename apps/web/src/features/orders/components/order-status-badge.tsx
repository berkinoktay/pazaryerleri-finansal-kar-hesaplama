'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

import { type OrderStatusValue } from '../lib/orders-filter-parsers';

type Tone = 'neutral' | 'success' | 'warning' | 'info';

const STATUS_TONES: Record<OrderStatusValue, Tone> = {
  PENDING: 'neutral',
  PROCESSING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
  RETURNED: 'warning',
};

export interface OrderStatusBadgeProps {
  status: OrderStatusValue;
  className?: string;
}

/**
 * Renders the marketplace lifecycle status. Mapped tones — delivered=success
 * is the only "good outcome" signal a seller scans for; returned=warning
 * draws attention even before settlement reconciliation kicks in.
 */
export function OrderStatusBadge({ status, className }: OrderStatusBadgeProps): React.ReactElement {
  const t = useTranslations('ordersPage.status');
  return (
    <Badge tone={STATUS_TONES[status]} size="sm" className={className}>
      {t(status)}
    </Badge>
  );
}
