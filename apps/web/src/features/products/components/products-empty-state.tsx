'use client';

import { PackageIcon, StoreLocation01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { TableNoResultsState } from '@/components/patterns/data-table-states';
import { Button } from '@/components/ui/button';

export type ProductsEmptyStateVariant =
  | 'no-store'
  | 'no-products'
  | 'filtered'
  | 'missing-cost-none'
  | 'missing-desi-none';

// All-clear title of each override tab's empty state ("every product has a
// cost / desi"). Shown by resolveProductsEmptyVariant only when no search or
// filter is active, because only then is the claim true.
const ALL_CLEAR_TITLE_KEY = {
  'missing-cost-none': 'missingCostNone',
  'missing-desi-none': 'missingDesiNone',
} as const;

function isAllClearVariant(
  variant: ProductsEmptyStateVariant,
): variant is keyof typeof ALL_CLEAR_TITLE_KEY {
  return variant in ALL_CLEAR_TITLE_KEY;
}

interface ProductsEmptyStateProps {
  variant: ProductsEmptyStateVariant;
  /** Resets every active search / filter. Wires the `filtered` variant's
   *  "Clear filters" button (the shared no-results state). */
  onClearFilters?: () => void;
}

export function ProductsEmptyState({
  variant,
  onClearFilters,
}: ProductsEmptyStateProps): React.ReactElement {
  const t = useTranslations('products.empty');

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
  if (isAllClearVariant(variant)) {
    return <EmptyState embedded title={t(ALL_CLEAR_TITLE_KEY[variant])} />;
  }
  // Filtered-to-zero → the shared no-results preset (filter-off icon + a real
  // "Clear filters" button), so products gets the same premium no-results
  // treatment as every other table instead of a bare title.
  return <TableNoResultsState onClearFilters={onClearFilters} />;
}
