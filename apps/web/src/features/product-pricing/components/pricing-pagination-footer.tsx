'use client';

import { type PaginationState, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import * as React from 'react';

import { DataTablePagination } from '@/components/patterns/data-table-pagination';

import type { ProductPricingItem } from '../api/list-product-pricing.api';

interface PricingPaginationFooterProps {
  rows: ProductPricingItem[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  pageSizes: readonly number[];
  onPaginationChange: (next: { page: number; perPage: number }) => void;
}

/**
 * Standalone pagination footer for the cards view. The shared
 * `DataTablePagination` reads everything from a TanStack table instance, so
 * the cards grid (which has no DataTable of its own) builds a minimal
 * manual-pagination instance here purely to drive the same numbered footer —
 * no fork of the pagination UI. Columns are empty because the footer only
 * needs the pagination math (`pageCount` / `rowCount` / `pagination` state).
 */
export function PricingPaginationFooter({
  rows,
  page,
  perPage,
  total,
  totalPages,
  pageSizes,
  onPaginationChange,
}: PricingPaginationFooterProps): React.ReactElement {
  const paginationState: PaginationState = React.useMemo(
    () => ({ pageIndex: page - 1, pageSize: perPage }),
    [page, perPage],
  );

  const handlePaginationChange = React.useCallback(
    (updater: PaginationState | ((prev: PaginationState) => PaginationState)) => {
      const next = typeof updater === 'function' ? updater(paginationState) : updater;
      onPaginationChange({ page: next.pageIndex + 1, perPage: next.pageSize });
    },
    [onPaginationChange, paginationState],
  );

  const table = useReactTable<ProductPricingItem>({
    data: rows,
    columns: [],
    state: { pagination: paginationState },
    onPaginationChange: handlePaginationChange,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
    rowCount: total,
    getRowId: (row) => row.variantId,
  });

  return (
    <div className="border-border bg-card rounded-lg border">
      <div className="px-md py-sm">
        <DataTablePagination table={table} pageSizes={pageSizes} />
      </div>
    </div>
  );
}
