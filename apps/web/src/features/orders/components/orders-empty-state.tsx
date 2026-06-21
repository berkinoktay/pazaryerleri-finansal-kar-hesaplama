'use client';

import { Invoice03Icon, StoreLocation01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';

interface OrdersEmptyStateProps {
  variant: 'no-store' | 'no-orders';
  /**
   * `no-store` is a Tier-1 page-level hero (rendered before the table when no
   * store is connected) and stays a standalone card. `no-orders` renders INSIDE
   * the DataTable's `empty` slot once a store IS connected, so it passes
   * `embedded` to drop the card frame and span the table body.
   */
  embedded?: boolean;
}

export function OrdersEmptyState({
  variant,
  embedded = false,
}: OrdersEmptyStateProps): React.ReactElement {
  const t = useTranslations('ordersPage.empty');

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

  return (
    <EmptyState
      embedded={embedded}
      icon={Invoice03Icon}
      title={t('noOrders.title')}
      description={t('noOrders.description')}
    />
  );
}
