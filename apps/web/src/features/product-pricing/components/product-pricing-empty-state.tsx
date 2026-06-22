'use client';

import { Layers01Icon, PackageIcon, StoreLocation01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export type ProductPricingEmptyVariant = 'no-store' | 'no-products' | 'no-matches';

interface ProductPricingEmptyStateProps {
  variant: ProductPricingEmptyVariant;
  /** Fired when the user clicks "Sıfırla" on the no-matches variant. */
  onClearFilters?: () => void;
}

export function ProductPricingEmptyState({
  variant,
  onClearFilters,
}: ProductPricingEmptyStateProps): React.ReactElement {
  const t = useTranslations('features.productPricing.empty');

  if (variant === 'no-store') {
    return (
      <EmptyState
        embedded
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
        embedded
        icon={PackageIcon}
        title={t('noProducts.title')}
        description={t('noProducts.description')}
      />
    );
  }

  return (
    <EmptyState
      embedded
      icon={Layers01Icon}
      title={t('noMatches.title')}
      description={t('noMatches.description')}
      action={
        onClearFilters !== undefined ? (
          <Button variant="outline" onClick={onClearFilters}>
            {t('noMatches.action')}
          </Button>
        ) : undefined
      }
    />
  );
}
