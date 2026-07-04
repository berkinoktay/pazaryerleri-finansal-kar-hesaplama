'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { type FilterFieldDef } from '@/lib/advanced-filter';

import { TARIFF_FILTER_FIELDS } from '../lib/tariff-filter-fields';

/**
 * The Advantage tariff-detail Advanced-Filter catalog. Reuses the shared field KEYS +
 * chip adapters (`tariff-filter-fields.ts`) — only the localized labels differ, so
 * category/brand options come from the loaded rows and profit/margin read the BEST
 * tier's scenario. minMargin is a single lower bound; profit and selection are
 * tri-states whose 'all' case is simply "no chip".
 */
export function useAdvantageTariffFilterFields(
  categories: readonly string[],
  brands: readonly string[],
): FilterFieldDef[] {
  const t = useTranslations('productLabelsPage.filters');

  return React.useMemo<FilterFieldDef[]>(() => {
    const group = t('groupLabel');
    return [
      {
        key: TARIFF_FILTER_FIELDS.category,
        label: t('category'),
        groupLabel: group,
        dataType: 'enumSingle',
        operators: ['eq'],
        enumValues: categories.map((category) => ({ value: category, label: category })),
      },
      {
        key: TARIFF_FILTER_FIELDS.brand,
        label: t('brand'),
        groupLabel: group,
        dataType: 'enumSingle',
        operators: ['eq'],
        enumValues: brands.map((brand) => ({ value: brand, label: brand })),
      },
      {
        key: TARIFF_FILTER_FIELDS.minMargin,
        label: t('minMargin'),
        groupLabel: group,
        dataType: 'percent',
        operators: ['gte'],
        unit: '%',
      },
      {
        key: TARIFF_FILTER_FIELDS.profit,
        label: t('profit'),
        groupLabel: group,
        dataType: 'enumSingle',
        operators: ['eq'],
        enumValues: [
          { value: 'profitable', label: t('profitProfitable') },
          { value: 'loss', label: t('profitLoss') },
        ],
      },
      {
        key: TARIFF_FILTER_FIELDS.selection,
        label: t('selection'),
        groupLabel: group,
        dataType: 'enumSingle',
        operators: ['eq'],
        enumValues: [
          { value: 'selected', label: t('selectionSelected') },
          { value: 'unselected', label: t('selectionUnselected') },
        ],
      },
    ];
  }, [t, categories, brands]);
}
