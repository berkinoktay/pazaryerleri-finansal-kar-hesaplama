'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { FilterTabs, type FilterTabOption } from '@/components/patterns/filter-tabs';

import { type CostStatusValue } from '../lib/orders-filter-parsers';

interface OrdersCostStatusTabsProps {
  value: CostStatusValue;
  counts: { calculated: number; excluded: number };
  loading?: boolean;
  onChange: (next: CostStatusValue) => void;
}

/**
 * Profit-universe segment strip mounted in the orders DataTable `tabs` slot.
 * `Hesaplanmış` (clean ledger, default) | `Kâr Hesabı Dışı (N)` — an INFO
 * segment, not a worklist (spec 2026-06-12: the cost window is the order day;
 * missing it is permanent, there is nothing to act on afterwards).
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
    { value: 'excluded', label: t('excluded'), count: counts.excluded },
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
