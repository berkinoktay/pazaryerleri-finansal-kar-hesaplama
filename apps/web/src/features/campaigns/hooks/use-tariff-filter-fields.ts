'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { type FilterFieldDef } from '@/lib/advanced-filter';

import { TARIFF_FILTER_FIELDS } from '../lib/tariff-filter-fields';

/**
 * The tariff-detail Advanced-Filter catalog. Category/brand options come from
 * the ACTIVE PERIOD's rows (client-side filtering — the whole tariff is in
 * memory). minMargin is a single lower bound (operators fixed to gte, so the
 * editor shows no operator select); profit and selection are tri-states whose
 * 'all' case is simply "no chip".
 */
export function useTariffFilterFields(
  categories: readonly string[],
  brands: readonly string[],
): FilterFieldDef[] {
  const t = useTranslations('commissionTariffsPage.filters');

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
        // Single lower bound by design ("en az %X marj") — one operator, so
        // the editor renders just the percent input.
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
