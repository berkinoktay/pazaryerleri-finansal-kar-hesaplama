'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

import { type ReconciliationStatusValue } from '../lib/orders-filter-parsers';

type Tone = 'neutral' | 'success' | 'warning';

const RECONCILIATION_TONES: Record<ReconciliationStatusValue, Tone> = {
  NOT_SETTLED: 'neutral',
  PARTIALLY_SETTLED: 'warning',
  FULLY_SETTLED: 'success',
};

export interface ReconciliationStatusBadgeProps {
  status: ReconciliationStatusValue;
  className?: string;
}

/**
 * Settlement progression signal. NOT_SETTLED = ESTIMATE-only (T+0).
 * PARTIALLY_SETTLED = first vendor settlement row landed. FULLY_SETTLED =
 * PaymentOrder confirmed + settledNetProfit computed.
 */
export function ReconciliationStatusBadge({
  status,
  className,
}: ReconciliationStatusBadgeProps): React.ReactElement {
  const t = useTranslations('ordersPage.reconciliationStatus');
  return (
    <Badge tone={RECONCILIATION_TONES[status]} size="sm" className={className}>
      {t(status)}
    </Badge>
  );
}
