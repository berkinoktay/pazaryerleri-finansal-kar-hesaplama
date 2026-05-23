'use client';

import { type ColumnDef, type PaginationState } from '@tanstack/react-table';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';

import { type OrderListItem } from '../api/list-orders.api';
import { ORDER_PER_PAGE_OPTIONS } from '../lib/orders-filter-parsers';

import { OrderStatusBadge } from './order-status-badge';
import { OrdersToolbar } from './orders-toolbar';
import { ReconciliationStatusBadge } from './reconciliation-status-badge';

type OrdersToolbarProps = React.ComponentProps<typeof OrdersToolbar>;

export interface OrdersTableProps {
  rows: OrderListItem[];
  loading?: boolean;
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
  filters: {
    q: string;
    status: OrderListItem['status'] | null;
    reconciliationStatus: OrderListItem['reconciliationStatus'] | null;
    from: string;
    to: string;
  };
  onFiltersChange: OrdersToolbarProps['onChange'];
  onPaginationChange: (next: { page?: number; perPage?: number }) => void;
}

/**
 * Server-paginated orders grid. The component is presentation-only — filter
 * state, pagination state, and the React Query call live in the page client.
 * Row click navigates to the order detail page.
 */
export function OrdersTable({
  rows,
  loading = false,
  pagination,
  filters,
  onFiltersChange,
  onPaginationChange,
}: OrdersTableProps): React.ReactElement {
  const t = useTranslations('ordersPage.table');
  const formatter = useFormatter();
  const router = useRouter();

  const columns = React.useMemo<ColumnDef<OrderListItem>[]>(
    () => [
      {
        id: 'orderDate',
        header: t('columns.orderDate'),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatter.dateTime(new Date(row.original.orderDate), 'short')}
          </span>
        ),
      },
      {
        id: 'platformOrderNumber',
        header: t('columns.orderNumber'),
        cell: ({ row }) => {
          const number = row.original.platformOrderNumber ?? row.original.platformOrderId;
          return <span className="font-medium">{number}</span>;
        },
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
      },
      {
        id: 'reconciliationStatus',
        header: t('columns.reconciliationStatus'),
        cell: ({ row }) => <ReconciliationStatusBadge status={row.original.reconciliationStatus} />,
      },
      {
        id: 'saleSubtotalNet',
        header: t('columns.saleSubtotalNet'),
        cell: ({ row }) => {
          const value = row.original.saleSubtotalNet;
          return value === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <Currency value={value} />
          );
        },
      },
      {
        id: 'estimatedNetProfit',
        header: t('columns.estimatedNetProfit'),
        cell: ({ row }) => {
          const value = row.original.estimatedNetProfit;
          return value === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <Currency value={value} />
          );
        },
      },
      {
        id: 'settledNetProfit',
        header: t('columns.settledNetProfit'),
        cell: ({ row }) => {
          const value = row.original.settledNetProfit;
          return value === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <Currency value={value} emphasis />
          );
        },
      },
      {
        id: 'itemCount',
        header: t('columns.itemCount'),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatter.number(row.original.itemCount, 'integer')}
          </span>
        ),
      },
    ],
    [t, formatter],
  );

  // Bridge the page-level (page, perPage) state to TanStack's PaginationState
  // ({ pageIndex, pageSize }). Manual pagination flips on as soon as we pass
  // both paginationState + onPaginationChange.
  const paginationState: PaginationState = {
    pageIndex: pagination.page - 1,
    pageSize: pagination.perPage,
  };

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
      onRowClick={(row) => router.push(`/orders/${row.id}`)}
      paginationState={paginationState}
      onPaginationChange={handlePaginationChange}
      pageCount={pagination.totalPages}
      rowCount={pagination.total}
      toolbar={() => (
        <OrdersToolbar
          q={filters.q}
          status={filters.status}
          reconciliationStatus={filters.reconciliationStatus}
          from={filters.from}
          to={filters.to}
          onChange={onFiltersChange}
        />
      )}
      pagination={(table) => (
        <DataTablePagination table={table} pageSizes={ORDER_PER_PAGE_OPTIONS} />
      )}
    />
  );
}
