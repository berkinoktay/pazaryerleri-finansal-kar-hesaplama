'use client';

import { toUtcIsoDate } from '@pazarsync/utils';
import { type Table } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';

import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { DateRangePicker } from '@/components/patterns/date-range-picker';

/** Partial filter update emitted by the toolbar — the page client owns the URL state. */
export interface ReturnsToolbarChange {
  q?: string;
  from?: string;
  to?: string;
}

export interface ReturnsToolbarProps<TData> {
  table: Table<TData>;
  q: string;
  from: string;
  to: string;
  onChange: (next: ReturnsToolbarChange) => void;
}

/**
 * Returns toolbar as a thin composition over the shared DataTableToolbar:
 * controlled search (debounce-free by design — the claims list is
 * server-paginated and queries are inexpensive) + the claimDate
 * DateRangePicker in the facets slot. The status dimension lives in the tab
 * strip, so there is no advancedFilter catalog here. Server-mode
 * hasActiveFilters/onClearFilters drive the clear ghost (filters are URL
 * params, invisible to TanStack columnFilters).
 */
export function ReturnsToolbar<TData>({
  table,
  q,
  from,
  to,
  onChange,
}: ReturnsToolbarProps<TData>): React.ReactElement {
  const t = useTranslations('returnsPage');

  const range: DateRange | undefined =
    from.length > 0 || to.length > 0
      ? {
          from: from.length > 0 ? new Date(from) : undefined,
          to: to.length > 0 ? new Date(to) : undefined,
        }
      : undefined;

  const handleRangeChange = (next: DateRange | undefined): void => {
    onChange({
      from: next?.from !== undefined ? toUtcIsoDate(next.from) : '',
      to: next?.to !== undefined ? toUtcIsoDate(next.to) : '',
    });
  };

  const hasAnyFilter = q.length > 0 || from.length > 0 || to.length > 0;

  return (
    <DataTableToolbar
      table={table}
      searchValue={q}
      onSearchChange={(next) => onChange({ q: next })}
      searchPlaceholder={t('toolbar.searchPlaceholder')}
      hasActiveFilters={hasAnyFilter}
      onClearFilters={() => onChange({ q: '', from: '', to: '' })}
      facets={<DateRangePicker value={range} onChange={handleRangeChange} />}
    />
  );
}
