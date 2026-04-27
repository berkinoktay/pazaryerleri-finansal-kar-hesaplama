'use client';

import { PackageIcon, StoreLocation01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';

interface ProductsEmptyStateProps {
  variant: 'no-store' | 'no-products' | 'filtered';
}

export function ProductsEmptyState({ variant }: ProductsEmptyStateProps): React.ReactElement {
  const t = useTranslations('products.empty');

  if (variant === 'no-store') {
    return (
      <EmptyState
        icon={StoreLocation01Icon}
        title={t('noStore.title')}
        description={t('noStore.description')}
        action={
          <Button asChild>
            <Link href="/stores">{t('noStore.cta')}</Link>
          </Button>
        }
      />
    );
  }
  if (variant === 'no-products') {
    return (
      <EmptyState
        icon={PackageIcon}
        title={t('noProducts.title')}
        description={t('noProducts.description')}
      />
    );
  }
  return <EmptyState title={t('filtered')} />;
}
