'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { FilterTabs, type FilterTabOption } from '@/components/patterns/filter-tabs';

import type { ProductFacetsResponse } from '../api/list-product-facets.api';
import type { ProductOverrideMissing } from '../lib/products-filter-parsers';

export type ProductsOverrideTab = 'all' | ProductOverrideMissing;

interface ProductsTabStripProps {
  value: ProductsOverrideTab;
  counts?: ProductFacetsResponse['overrideCounts'];
  loading?: boolean;
  onChange: (next: ProductsOverrideTab) => void;
}

/**
 * Override-state tab strip mounted above the products table. The three options
 * (all products / missing cost / missing desi) reflect the `overrideMissing`
 * filter on the products list endpoint and surface the per-state counts from
 * the facets endpoint's `overrideCounts`, so each badge equals its tab's list
 * total.
 *
 * The counts cover the store's default listing scope (not delisted, not
 * archived) and ignore the q / advanced filters, so the "all" count always
 * equals the unfiltered list total. Loading state renders count slots as
 * Skeletons of the same footprint to keep the strip stable while the facets
 * request settles.
 *
 * @useWhen rendering the override-state tab strip on the products page
 *          (this is a feature-private wrapper over FilterTabs, not a
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
    { value: 'desi', label: t('missingDesi'), count: counts?.missingDesi },
  ];
  return (
    // Three long labels with count chips outgrow a phone-width toolbar; the
    // strip scrolls sideways there instead of widening the page.
    <FilterTabs<ProductsOverrideTab>
      value={value}
      onValueChange={onChange}
      options={options}
      loading={loading}
      className="max-w-full overflow-x-auto"
    />
  );
}
