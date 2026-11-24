'use client';

import { Invoice03Icon, StoreLocation01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { LIVE_PERFORMANCE_PATH } from '@/lib/live-performance-links';

interface OrdersEmptyStateProps {
  /**
   * `open-day-only`: the store has orders, but all of them are today's, which
   * the list leaves out until the day ends; it points to live performance.
   */
  variant: 'no-store' | 'no-orders' | 'open-day-only';
  /**
   * `no-store` is a Tier-1 page-level hero (rendered before the table when no
   * store is connected) and stays a standalone card. `no-orders` and
   * `open-day-only` render INSIDE the DataTable's `empty` slot once a store IS
   * connected, so they pass `embedded` to drop the card frame and span the
   * table body.
   */
  embedded?: boolean;
}

export function OrdersEmptyState({
  variant,
  embedded = false,
}: OrdersEmptyStateProps): React.ReactElement {
  const t = useTranslations('ordersPage.empty');
  const tOpenDay = useTranslations('ordersPage.openDay');

  if (variant === 'no-store') {
    return (
      <EmptyState
        icon={StoreLocation01Icon}
        title={t('noStore.title')}
        description={t('noStore.description')}
        action={
          <Button asChild>
            <Link href="/settings/stores">{t('noStore.cta')}</Link>
          </Button>
        }
      />
    );
  }

  if (variant === 'open-day-only') {
    return (
      <EmptyState
        embedded={embedded}
        icon={Invoice03Icon}
        title={t('openDayOnly')}
        description={tOpenDay('todayNotice')}
        action={
          <Button asChild>
            <Link href={LIVE_PERFORMANCE_PATH}>{tOpenDay('todayLink')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      embedded={embedded}
      icon={Invoice03Icon}
      title={t('noOrders.title')}
      description={t('noOrders.description')}
    />
  );
}
