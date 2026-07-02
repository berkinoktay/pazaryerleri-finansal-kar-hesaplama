'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { DATATYPE_OPERATORS, type FilterFieldDef } from '@/lib/advanced-filter';

import { ORDER_FILTER_FIELDS } from '../lib/orders-filter-fields';
import { ORDER_STATUSES, RECONCILIATION_STATUSES } from '../lib/orders-filter-parsers';

/**
 * The orders Advanced-Filter catalog: order status and reconciliation status
 * as single-select dimensions (the backend accepts ONE value each) plus the
 * loss-only flag. Drives the toolbar's `advancedFilter` config. Search, the
 * orderDate range (DateRangePicker) and the cost-status tabs stay outside
 * the chip system.
 */
export function useOrderFilterFields(): FilterFieldDef[] {
  const t = useTranslations('ordersPage');

  return React.useMemo<FilterFieldDef[]>(() => {
    const statusGroup = t('advancedFilters.groups.status');
    return [
      {
        key: ORDER_FILTER_FIELDS.status,
        label: t('advancedFilters.fields.status'),
        groupLabel: statusGroup,
        dataType: 'enumSingle',
        operators: [...DATATYPE_OPERATORS.enumSingle],
        enumValues: ORDER_STATUSES.map((status) => ({
          value: status,
          label: t(`status.${status}`),
        })),
      },
      {
        key: ORDER_FILTER_FIELDS.reconciliationStatus,
        label: t('advancedFilters.fields.reconciliationStatus'),
        groupLabel: statusGroup,
        dataType: 'enumSingle',
        operators: [...DATATYPE_OPERATORS.enumSingle],
        enumValues: RECONCILIATION_STATUSES.map((status) => ({
          value: status,
          label: t(`reconciliationStatus.${status}`),
        })),
      },
      {
        key: ORDER_FILTER_FIELDS.lossOnly,
        label: t('toolbar.lossOnly'),
        groupLabel: t('advancedFilters.groups.flag'),
        dataType: 'flag',
        operators: [...DATATYPE_OPERATORS.flag],
      },
    ];
  }, [t]);
}
