'use client';

import { Invoice03Icon, StoreLocation01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';

interface OrdersEmptyStateProps {
  variant: 'no-store' | 'no-orders';
}

export function OrdersEmptyState({ variant }: OrdersEmptyStateProps): React.ReactElement {
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
      icon={Invoice03Icon}
      title={t('noOrders.title')}
      description={t('noOrders.description')}
    />
  );
}
