'use client';

import { CheckmarkCircle02Icon, Clock04Icon, RefreshIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { type OrderDetail } from '../api/get-order.api';

type AlertTone = 'neutral' | 'info' | 'success' | 'warning' | 'destructive';

interface BannerConfig {
  tone: AlertTone;
  icon: React.ComponentType<{ className?: string }>;
  titleKey: 'NOT_SETTLED' | 'PARTIALLY_SETTLED' | 'FULLY_SETTLED';
}

const RECONCILIATION_CONFIG: Record<OrderDetail['reconciliationStatus'], BannerConfig> = {
  NOT_SETTLED: { tone: 'neutral', icon: Clock04Icon, titleKey: 'NOT_SETTLED' },
  PARTIALLY_SETTLED: { tone: 'warning', icon: RefreshIcon, titleKey: 'PARTIALLY_SETTLED' },
  FULLY_SETTLED: { tone: 'success', icon: CheckmarkCircle02Icon, titleKey: 'FULLY_SETTLED' },
};

export interface OrderStatusBannerProps {
  order: Pick<OrderDetail, 'reconciliationStatus' | 'paymentDate' | 'paymentOrderId' | 'updatedAt'>;
}

/**
 * Reconciliation state machine signal at the top of the order detail.
 * Beyond the badge in the table, this banner explains what the state
 * means and what the seller can expect next. The icon and tone are
 * deterministic per state — never paint informational state in accent
 * color, the dashboard reserves accents for headline metrics.
 */
export function OrderStatusBanner({ order }: OrderStatusBannerProps): React.ReactElement {
  const t = useTranslations('orderDetail.banner');
  const formatter = useFormatter();
  const config = RECONCILIATION_CONFIG[order.reconciliationStatus];
  const Icon = config.icon;

  const description =
    order.reconciliationStatus === 'FULLY_SETTLED' && order.paymentDate !== null
      ? t('descriptions.FULLY_SETTLED_WITH_DATE', {
          date: formatter.dateTime(new Date(order.paymentDate), 'short'),
        })
      : t(`descriptions.${config.titleKey}`);

  return (
    <Alert tone={config.tone} size="md" radius="lg">
      <Icon data-alert-icon className="size-icon-sm mt-3xs" />
      <div className="gap-3xs flex flex-col">
        <AlertTitle>{t(`titles.${config.titleKey}`)}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </div>
    </Alert>
  );
}
