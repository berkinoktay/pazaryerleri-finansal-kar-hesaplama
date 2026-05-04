'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { FilterTabs, type FilterTabOption } from '@/components/patterns/filter-tabs';

export type ProductsOverrideTab = 'all' | 'cost' | 'vat';

interface ProductsTabStripProps {
  value: ProductsOverrideTab;
  counts?: { missingCost: number; missingVat: number; total: number };
  loading?: boolean;
  onChange: (next: ProductsOverrideTab) => void;
}

/**
 * Override-state tab strip mounted above the products table. The three
 * options (Tümü · Maliyeti girilmemiş · KDV girilmemiş) reflect the
 * `overrideMissing` filter on the products list endpoint and surface
 * the per-state counts from the facets endpoint's `overrideCounts`.
 *
 * Counts are computed against the unfiltered store-scoped product set
 * (per spec §5.3) — switching tabs implicitly resets the q / brand /
 * category / status filters at the page-client level. Loading state
 * renders count slots as Skeletons of the same footprint to keep the
 * strip stable while the facets request settles.
 *
 * @useWhen rendering the override-state tab strip on the products page
 *          (this is a feature-private wrapper over FilterTabs — not a
 *          general-purpose tab pattern)
 */
export function ProductsTabStrip({
  value,
  counts,
  loading = false,
  onChange,
}: ProductsTabStripProps): React.ReactElement {
  const t = useTranslations('products.overrideTabs');
  const options: FilterTabOption<ProductsOverrideTab>[] = [
    { value: 'all', label: t('all'), count: counts?.total },
    { value: 'cost', label: t('missingCost'), count: counts?.missingCost },
    { value: 'vat', label: t('missingVat'), count: counts?.missingVat },
  ];
  return (
    <FilterTabs<ProductsOverrideTab>
      value={value}
      onValueChange={onChange}
      options={options}
      loading={loading}
    />
  );
}
