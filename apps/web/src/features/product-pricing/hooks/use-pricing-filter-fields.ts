'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { DATATYPE_OPERATORS, type FilterFieldDef } from '@/lib/advanced-filter';

import type { PricingFacetsResponse } from '../api/list-pricing-facets.api';
import { PRICING_FILTER_FIELDS } from '../lib/pricing-filter-fields';

/**
 * The pricing Advanced-Filter catalog: category + brand as single-select
 * dimensions (the backend accepts ONE id each), the sale-margin range as a
 * percent field, and the loss-only flag (→ profitStatus: 'loss'). Search
 * stays outside the chip system (controlled toolbar search, debounced in
 * the page client).
 */
export function usePricingFilterFields(
  facets: PricingFacetsResponse | undefined,
): FilterFieldDef[] {
  const t = useTranslations('features.productPricing.toolbar');

  return React.useMemo<FilterFieldDef[]>(() => {
    const categories = facets?.categories ?? [];
    const brands = facets?.brands ?? [];
    const attributeGroup = t('advancedFilters.groups.attribute');

    return [
      {
        key: PRICING_FILTER_FIELDS.category,
        label: t('categoryLabel'),
        groupLabel: attributeGroup,
        dataType: 'enumSingle',
        operators: [...DATATYPE_OPERATORS.enumSingle],
        enumValues: categories.map((category) => ({ value: category.id, label: category.name })),
      },
      {
        key: PRICING_FILTER_FIELDS.brand,
        label: t('brandLabel'),
        groupLabel: attributeGroup,
        dataType: 'enumSingle',
        operators: [...DATATYPE_OPERATORS.enumSingle],
        enumValues: brands.map((brand) => ({ value: brand.id, label: brand.name })),
      },
      {
        key: PRICING_FILTER_FIELDS.margin,
        label: t('marginRangeLabel'),
        groupLabel: t('advancedFilters.groups.range'),
        dataType: 'percent',
        operators: [...DATATYPE_OPERATORS.percent],
        unit: '%',
      },
      {
        key: PRICING_FILTER_FIELDS.lossOnly,
        label: t('lossOnly'),
        groupLabel: t('advancedFilters.groups.flag'),
        dataType: 'flag',
        operators: [...DATATYPE_OPERATORS.flag],
      },
    ];
  }, [t, facets]);
}
