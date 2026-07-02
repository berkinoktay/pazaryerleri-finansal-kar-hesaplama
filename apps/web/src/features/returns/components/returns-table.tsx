'use client';

import { type ColumnDef, type PaginationState } from '@tanstack/react-table';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { EmptyState } from '@/components/patterns/empty-state';

import { type ClaimListItem } from '../api/list-claims.api';
import { RETURNS_PER_PAGE_OPTIONS, type ClaimStatusTabValue } from '../lib/returns-filter-parsers';

import { ClaimScopeBadge } from './claim-scope-badge';
import { ClaimStatusBadge } from './claim-status-badge';
import { ReturnsStatusTabs } from './returns-status-tabs';
import { ReturnsToolbar, type ReturnsToolbarChange } from './returns-toolbar';

export interface ReturnsTableProps {
  rows: ClaimListItem[];
  loading?: boolean;
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
  filters: {
    q: string;
    from: string;
    to: string;
  };
  status: ClaimStatusTabValue;
  counts: { all: number; open: number; resolved: number };
  tabsLoading?: boolean;
  onStatusChange: (next: ClaimStatusTabValue) => void;
  onFiltersChange: (next: ReturnsToolbarChange) => void;
  onPaginationChange: (next: { page?: number; perPage?: number }) => void;
}

/**
 * Server-paginated return-claims grid. Presentation-only — filter state,
 * pagination state, and the React Query call live in the page client.
 * Row click navigates to the ORDER detail (the claim card + fee timeline
 * live there; V1 has no dedicated claim detail page by design).
 */
export function ReturnsTable({
  rows,
  loading = false,
  pagination,
  filters,
  status,
  counts,
  tabsLoading = false,
  onStatusChange,
  onFiltersChange,
  onPaginationChange,
}: ReturnsTableProps): React.ReactElement {
  const t = useTranslations('returnsPage.table');
  const tPage = useTranslations('returnsPage');
  const formatter = useFormatter();
  const router = useRouter();

  const columns = React.useMemo<ColumnDef<ClaimListItem>[]>(
    () => [
      {
        id: 'claimDate',
        header: t('columns.claimDate'),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatter.dateTime(new Date(row.original.claimDate), 'short')}
          </span>
        ),
      },
      {
        id: 'orderNumber',
        header: t('columns.orderNumber'),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.platformOrderNumber ?? '—'}</span>
        ),
      },
      {
        id: 'product',
        header: t('columns.product'),
        cell: ({ row }) => {
          const { firstName, units, otherCount } = row.original.productSummary;
          return (
            <span className="gap-2xs inline-flex items-baseline">
              <span>{firstName ?? tPage('summary.unknownProduct')}</span>
              <span className="text-muted-foreground text-sm">
                {tPage('summary.units', { count: units })}
              </span>
              {otherCount > 0 ? (
                <span className="text-muted-foreground text-sm">
                  {tPage('summary.more', { count: otherCount })}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'reason',
        header: t('columns.reason'),
        cell: ({ row }) => {
          const { first, otherCount } = row.original.reasonSummary;
          return (
            <span className="gap-2xs inline-flex items-baseline">
              <span>{first}</span>
              {otherCount > 0 ? (
                <span className="text-muted-foreground text-sm">
                  {tPage('summary.more', { count: otherCount })}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'scope',
        header: t('columns.scope'),
        cell: ({ row }) => <ClaimScopeBadge scope={row.original.scope} />,
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => <ClaimStatusBadge status={row.original.derivedStatus} />,
      },
    ],
    [t, tPage, formatter],
  );

  // Bridge the page-level (page, perPage) state to TanStack's PaginationState
  // ({ pageIndex, pageSize }) — same as OrdersTable.
  const paginationState: PaginationState = {
    pageIndex: pagination.page - 1,
    pageSize: pagination.perPage,
  };

  // Server-filtered: filters live in props, so the table can't detect
  // "filtered" on its own. The status TAB is not a clearable filter — only
  // the toolbar dimensions count here.
  const hasActiveFilters = Boolean(filters.q || filters.from || filters.to);

  const handlePaginationChange = (
    updater: PaginationState | ((prev: PaginationState) => PaginationState),
  ): void => {
    const next = typeof updater === 'function' ? updater(paginationState) : updater;
    onPaginationChange({
      page: next.pageIndex + 1,
      perPage: next.pageSize,
    });
  };

  return (
    <DataTable
      columns={columns}
      data={rows}
      loading={loading}
      onRowClick={(row) => router.push(`/orders/${row.orderId}`)}
      paginationState={paginationState}
      onPaginationChange={handlePaginationChange}
      pageCount={pagination.totalPages}
      rowCount={pagination.total}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={() => onFiltersChange({ q: '', from: '', to: '' })}
      tabs={
        <ReturnsStatusTabs
          value={status}
          counts={counts}
          loading={tabsLoading}
          onChange={onStatusChange}
        />
      }
      empty={
        <EmptyState
          embedded
          title={tPage('empty.noReturns.title')}
          description={tPage('empty.noReturns.description')}
        />
      }
      toolbar={(table) => (
        <ReturnsToolbar
          table={table}
          q={filters.q}
          from={filters.from}
          to={filters.to}
          onChange={onFiltersChange}
        />
      )}
      pagination={(table) => (
        <DataTablePagination table={table} pageSizes={RETURNS_PER_PAGE_OPTIONS} />
      )}
    />
  );
}
