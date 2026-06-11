'use client';

import { ReturnRequestIcon, StoreLocation01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';

interface ReturnsEmptyStateProps {
  variant: 'no-store' | 'no-returns';
}

export function ReturnsEmptyState({ variant }: ReturnsEmptyStateProps): React.ReactElement {
  const t = useTranslations('returnsPage.empty');

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
      icon={ReturnRequestIcon}
      title={t('noReturns.title')}
      description={t('noReturns.description')}
    />
  );
}
