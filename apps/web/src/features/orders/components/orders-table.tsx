'use client';

import { type ColumnDef, type PaginationState, type SortingState } from '@tanstack/react-table';
import { Alert02Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { EmptyState } from '@/components/patterns/empty-state';
import { PromotionIndicator } from '@/components/patterns/promotion-indicator';

import { type OrderListItem } from '../api/list-orders.api';
import {
  type CostStatusValue,
  type OrderSortValue,
  MARGIN_COLUMN_ID,
  ORDER_PER_PAGE_OPTIONS,
  orderSortToTanstack,
  tanstackToOrderSort,
} from '../lib/orders-filter-parsers';

import { OrderStatusBadge } from './order-status-badge';
import { OrdersCostStatusTabs } from './orders-cost-status-tabs';
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
  costStatus: CostStatusValue;
  /** Active server-side sort key (URL state). Drives the margin header arrow. */
  sort: OrderSortValue;
  counts: { calculated: number; excluded: number };
  tabsLoading?: boolean;
  onCostStatusChange: (next: CostStatusValue) => void;
  onFiltersChange: OrdersToolbarProps['onChange'];
  onPaginationChange: (next: { page?: number; perPage?: number }) => void;
  /** Commits a new server-side sort key when the user toggles the margin header. */
  onSortChange: (next: OrderSortValue) => void;
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
  costStatus,
  sort,
  counts,
  tabsLoading = false,
  onCostStatusChange,
  onFiltersChange,
  onPaginationChange,
  onSortChange,
}: OrdersTableProps): React.ReactElement {
  const t = useTranslations('ordersPage.table');
  const tPage = useTranslations('ordersPage');
  const formatter = useFormatter();
  const router = useRouter();

  const columns = React.useMemo<ColumnDef<OrderListItem>[]>(() => {
    if (costStatus === 'excluded') {
      return [
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
          id: 'saleGross',
          header: t('columns.revenue'),
          cell: ({ row }) => {
            const value = row.original.saleGross;
            return value === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <Currency value={value} />
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
        {
          // Bilgilendirme hücresi (iş listesi DEĞİL — spec 2026-06-12): pencere
          // kaçmış, dışlama kalıcı; satıcının yapacağı bir aksiyon yok. Ciro
          // kayıtlı kalır, kâr alanları donuk. Satır tıklaması detaydaki kalıcı
          // banner'a götürür.
          id: 'profitExcluded',
          header: t('columns.costStatus'),
          cell: () => (
            <span className="gap-2xs text-muted-foreground inline-flex items-center text-sm">
              <Alert02Icon className="size-icon-sm" />
              {tPage('excludedList.label')}
            </span>
          ),
        },
      ];
    }
    return [
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
          return (
            <span className="gap-xs flex items-center">
              <span className="font-medium">{number}</span>
              {/* İndirimli siparişte promosyon adlarını gösteren gürültüsüz rozet
                  (spec ekleme #3). Promosyon yoksa hiçbir şey çizilmez. */}
              <PromotionIndicator promotions={row.original.promotionDisplays} />
            </span>
          );
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
        id: 'saleGross',
        header: t('columns.saleGross'),
        cell: ({ row }) => {
          const value = row.original.saleGross;
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
        // Marj % — backend'de hesaplanıp persist edilen değer (settled ?? estimated).
        // accessorFn manualSorting altında getCanSort()'u açar (değer asla client-side
        // sıralama için OKUNMAZ — sıralama server-side); header buton olur. Render:
        // null → '—', aksi halde `${value}%` (% glyph'i salt gösterim, türetme yok).
        id: MARGIN_COLUMN_ID,
        accessorFn: (row) => row.saleMarginPct,
        header: t('columns.saleMarginPct'),
        enableSorting: true,
        meta: { numeric: true, label: t('columns.saleMarginPct') },
        cell: ({ row }) => {
          const value = row.original.saleMarginPct;
          return value === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums">{value}%</span>
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
    ];
  }, [t, tPage, formatter, costStatus]);

  // Bridge the page-level (page, perPage) state to TanStack's PaginationState
  // ({ pageIndex, pageSize }). Manual pagination flips on as soon as we pass
  // both paginationState + onPaginationChange.
  const paginationState: PaginationState = {
    pageIndex: pagination.page - 1,
    pageSize: pagination.perPage,
  };

  // Server-driven sort: the URL `sort` value drives the margin header arrow,
  // and a header toggle commits the next key back up to the page client (which
  // mutates URL state → refetch). Passing sorting + onSortingChange flips the
  // DataTable into manualSorting, so the data prop is already server-ordered.
  const sortingState: SortingState = orderSortToTanstack(sort);
  const handleSortingChange = (
    updater: SortingState | ((prev: SortingState) => SortingState),
  ): void => {
    const next = typeof updater === 'function' ? updater(sortingState) : updater;
    onSortChange(tanstackToOrderSort(next));
  };

  // Server-filtered: filters live in props (not TanStack columnFilters), so the
  // table can't detect "filtered" on its own. Telling it lets the zero-row body
  // render the no-results state (clear-filters CTA) instead of the first-run
  // empty — the page-client already routes the genuine no-orders case to its own
  // empty state before this table renders.
  const hasActiveFilters = Boolean(
    filters.q || filters.status || filters.reconciliationStatus || filters.from || filters.to,
  );

  const handlePaginationChange = (
    updater: PaginationState | ((prev: PaginationState) => PaginationState),
  ): void => {
    const next = typeof updater === 'function' ? updater(paginationState) : updater;
    onPaginationChange({
      page: next.pageIndex + 1,
      perPage: next.pageSize,
    });
  };

  const emptyState = (
    <EmptyState
      embedded
      title={
        costStatus === 'excluded' ? tPage('excludedList.empty') : tPage('tabs.emptyCalculated')
      }
    />
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      loading={loading}
      onRowClick={(row) => router.push(`/orders/${row.id}`)}
      sorting={sortingState}
      onSortingChange={handleSortingChange}
      paginationState={paginationState}
      onPaginationChange={handlePaginationChange}
      pageCount={pagination.totalPages}
      rowCount={pagination.total}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={() =>
        onFiltersChange({ q: '', status: null, reconciliationStatus: null, from: '', to: '' })
      }
      tabs={
        <OrdersCostStatusTabs
          value={costStatus}
          counts={counts}
          loading={tabsLoading}
          onChange={onCostStatusChange}
        />
      }
      empty={emptyState}
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
