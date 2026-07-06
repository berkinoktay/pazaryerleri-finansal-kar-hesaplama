'use client';

import { type Table } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';

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
 * server-paginated and queries are inexpensive). The status dimension lives in
 * the tab strip, and the claimDate DateRangePicker lives in the PageHeader
 * `filters` slot, not here — but `from`/`to` still flow through so the toolbar's
 * "clear all" affordance can reset the date range alongside the search. Server-
 * mode hasActiveFilters/onClearFilters drive the clear ghost (filters are URL
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

  const hasAnyFilter = q.length > 0 || from.length > 0 || to.length > 0;

  return (
    <DataTableToolbar
      table={table}
      searchValue={q}
      onSearchChange={(next) => onChange({ q: next })}
      searchPlaceholder={t('toolbar.searchPlaceholder')}
      hasActiveFilters={hasAnyFilter}
      onClearFilters={() => onChange({ q: '', from: '', to: '' })}
    />
  );
}
