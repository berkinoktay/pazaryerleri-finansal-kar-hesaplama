'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { FilterTabs, type FilterTabOption } from '@/components/patterns/filter-tabs';

import { type ClaimStatusTabValue } from '../lib/returns-filter-parsers';

interface ReturnsStatusTabsProps {
  value: ClaimStatusTabValue;
  counts: { all: number; open: number; resolved: number };
  loading?: boolean;
  onChange: (next: ClaimStatusTabValue) => void;
}

/**
 * Status segment strip mounted in the returns DataTable `tabs` slot.
 * `Tümü` | `Açık (N)` | `Sonuçlanan (N)`. Server-driven: the page client
 * owns the status URL state and the counts come from the claims list query
 * (tab-independent by contract). Mirrors OrdersCostStatusTabs.
 */
export function ReturnsStatusTabs({
  value,
  counts,
  loading = false,
  onChange,
}: ReturnsStatusTabsProps): React.ReactElement {
  const t = useTranslations('returnsPage.tabs');
  const options: FilterTabOption<ClaimStatusTabValue>[] = [
    { value: 'all', label: t('all'), count: counts.all },
    { value: 'open', label: t('open'), count: counts.open },
    { value: 'resolved', label: t('resolved'), count: counts.resolved },
  ];
  return (
    <FilterTabs<ClaimStatusTabValue>
      value={value}
      onValueChange={onChange}
      options={options}
      loading={loading}
    />
  );
}
