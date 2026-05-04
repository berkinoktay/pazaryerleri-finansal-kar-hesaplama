'use client';

import { PackageIcon, StoreLocation01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';

interface ProductsEmptyStateProps {
  variant: 'no-store' | 'no-products' | 'filtered' | 'missing-cost-none' | 'missing-vat-none';
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
            <Link href="/settings/stores">{t('noStore.cta')}</Link>
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
  if (variant === 'missing-cost-none') {
    return <EmptyState title={t('missingCostNone')} className="border-0" />;
  }
  if (variant === 'missing-vat-none') {
    return <EmptyState title={t('missingVatNone')} className="border-0" />;
  }
  return <EmptyState title={t('filtered')} />;
}
