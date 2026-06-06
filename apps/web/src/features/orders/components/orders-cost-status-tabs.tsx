'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { FilterTabs, type FilterTabOption } from '@/components/patterns/filter-tabs';

import { type CostStatusValue } from '../lib/orders-filter-parsers';

interface OrdersCostStatusTabsProps {
  value: CostStatusValue;
  counts: { calculated: number; pending: number };
  loading?: boolean;
  onChange: (next: CostStatusValue) => void;
}

/**
 * Cost-status segment strip mounted in the orders DataTable `tabs` slot.
 * `Hesaplanmış` (clean ledger, default) | `Maliyet Bekleyen (N)` (worklist).
 * Server-driven: the page client owns the costStatus URL state and the counts
 * come from the orders list query. Mirrors ProductsTabStrip — a feature-private
 * wrapper over the shared FilterTabs (which renders its own count chip).
 */
export function OrdersCostStatusTabs({
  value,
  counts,
  loading = false,
  onChange,
}: OrdersCostStatusTabsProps): React.ReactElement {
  const t = useTranslations('ordersPage.tabs');
  const options: FilterTabOption<CostStatusValue>[] = [
    { value: 'calculated', label: t('calculated'), count: counts.calculated },
    { value: 'pending', label: t('pending'), count: counts.pending },
  ];
  return (
    <FilterTabs<CostStatusValue>
      value={value}
      onValueChange={onChange}
      options={options}
      loading={loading}
    />
  );
}
