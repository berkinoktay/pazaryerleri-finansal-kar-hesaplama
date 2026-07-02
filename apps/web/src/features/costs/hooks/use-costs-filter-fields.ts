'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { DATATYPE_OPERATORS, type FilterFieldDef } from '@/lib/advanced-filter';

import { COSTS_FILTER_FIELDS } from '../lib/costs-filter-fields';
import { CostProfileType } from '../types/cost-profile.types';

/**
 * The costs Advanced-Filter catalog: profile type as a single-select (the
 * previously DEAD typeFilter plumbing, finally bound to a control) and the
 * archived flag (moved here from the hand-rolled PageHeader Switch).
 */
export function useCostsFilterFields(): FilterFieldDef[] {
  const t = useTranslations('costs');

  return React.useMemo<FilterFieldDef[]>(
    () => [
      {
        key: COSTS_FILTER_FIELDS.type,
        label: t('table.filters.typeLabel'),
        groupLabel: t('table.filters.groupLabel'),
        dataType: 'enumSingle',
        operators: [...DATATYPE_OPERATORS.enumSingle],
        enumValues: Object.values(CostProfileType).map((type) => ({
          value: type,
          label: t(`types.${type}`),
        })),
      },
      {
        key: COSTS_FILTER_FIELDS.archived,
        label: t('table.filters.showArchived'),
        groupLabel: t('table.filters.groupLabel'),
        dataType: 'flag',
        operators: [...DATATYPE_OPERATORS.flag],
      },
    ],
    [t],
  );
}
