'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { DATATYPE_OPERATORS, type FilterFieldDef } from '@/lib/advanced-filter';

import type { ProductFacetsResponse } from '../api/list-product-facets.api';
import { PRODUCT_FILTER_FIELDS } from '../lib/products-filter-fields';

// Common Turkish VAT rates as the fixed-select display options. The backend
// accepts any int (data-driven, no hardcoded set), so this list only shapes the
// UI — extend it here if the marketplace introduces a new rate.
const VAT_RATE_OPTIONS = ['0', '1', '10', '20'] as const;

/**
 * The products Advanced-Filter catalog: one FilterFieldDef per filterable
 * dimension, with localized labels and facet-driven brand/category options.
 * Drives the generic AdvancedFilterMenu. Rebuilds only when the locale or the
 * facet data changes.
 */
export function useProductFilterFields(
  facets: ProductFacetsResponse | undefined,
): FilterFieldDef[] {
  const t = useTranslations('products.advancedFilters');

  return React.useMemo<FilterFieldDef[]>(() => {
    const rangeGroup = t('groups.range');
    const attributeGroup = t('groups.attribute');
    const brands = facets?.brands ?? [];
    const categories = facets?.categories ?? [];

    return [
      {
        key: PRODUCT_FILTER_FIELDS.salePrice,
        label: t('fields.salePrice'),
        groupLabel: rangeGroup,
        dataType: 'money',
        operators: [...DATATYPE_OPERATORS.money],
        unit: '₺',
      },
      {
        key: PRODUCT_FILTER_FIELDS.stock,
        label: t('fields.stock'),
        groupLabel: rangeGroup,
        dataType: 'number',
        operators: [...DATATYPE_OPERATORS.number],
      },
      {
        key: PRODUCT_FILTER_FIELDS.vatRate,
        label: t('fields.vatRate'),
        groupLabel: attributeGroup,
        dataType: 'enumFixed',
        operators: [...DATATYPE_OPERATORS.enumFixed],
        enumValues: VAT_RATE_OPTIONS.map((rate) => ({
          value: rate,
          label: t('vatRateOption', { rate }),
        })),
      },
      {
        key: PRODUCT_FILTER_FIELDS.brand,
        label: t('fields.brand'),
        groupLabel: attributeGroup,
        dataType: 'enumMulti',
        operators: [...DATATYPE_OPERATORS.enumMulti],
        enumValues: brands.map((brand) => ({ value: brand.id, label: brand.name })),
      },
      {
        key: PRODUCT_FILTER_FIELDS.category,
        label: t('fields.category'),
        groupLabel: attributeGroup,
        dataType: 'enumMulti',
        operators: [...DATATYPE_OPERATORS.enumMulti],
        enumValues: categories.map((category) => ({ value: category.id, label: category.name })),
      },
    ];
  }, [t, facets]);
}
