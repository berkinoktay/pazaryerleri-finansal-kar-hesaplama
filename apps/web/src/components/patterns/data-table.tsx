'use client';

import {
  type ColumnDef,
  type ColumnFiltersState,
  type RowData,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown01Icon, ArrowUp01Icon, SortingDownIcon } from 'hugeicons-react';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Optional toolbar receives the table instance for faceted filter controls. */
  toolbar?: (table: TanstackTable<TData>) => React.ReactNode;
  /** Show loading skeletons in place of rows. */
  loading?: boolean;
  /** Custom content when the table has zero rows post-filter. */
  empty?: React.ReactNode;
  /** Enable row selection checkboxes (column must be defined separately). */
  enableRowSelection?: boolean;
  /** Row id accessor for stable selection state across re-renders. */
  getRowId?: (row: TData, index: number) => string;
}

/**
 * Thin wrapper over TanStack Table v8 with shadcn-style primitives and
 * PazarSync tokens. Opinionated defaults: sticky header, hover affordance,
 * sortable columns surface an icon, numeric columns (data-numeric=true on
 * header/cell) right-align via CSS.
 *
 * Scope of this initial version: client-side sort/filter/select. Server-side
 * pagination + virtualization are implementation concerns wired per-feature
 * (orders page, settlements page) rather than baked in here — each feature
 * has different pagination semantics.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  toolbar,
  loading = false,
  empty,
  enableRowSelection = false,
  getRowId,
}: DataTableProps<TData, TValue>): React.ReactElement {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection,
    getRowId,
  });

  return (
    <div className="gap-md flex flex-col">
      {toolbar ? toolbar(table) : null}
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isNumeric = header.column.columnDef.meta?.numeric === true;
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      data-numeric={isNumeric || undefined}
                      className={cn(isNumeric && 'text-right')}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            'gap-3xs px-3xs py-3xs -mx-3xs duration-fast inline-flex items-center rounded-sm transition-colors',
                            'hover:bg-background',
                            'focus-visible:outline-none',
                            isNumeric && 'ml-auto',
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortDir === 'asc' ? (
                            <ArrowUp01Icon className="size-icon-xs" />
                          ) : sortDir === 'desc' ? (
                            <ArrowDown01Icon className="size-icon-xs" />
                          ) : (
                            <SortingDownIcon className="size-icon-xs opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {columns.map((_col, colIdx) => (
                    <TableCell key={colIdx}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  {empty ?? (
                    <EmptyState
                      title="Gösterilecek kayıt yok"
                      description="Filtreleri temizleyin veya senkronizasyonu yenileyin."
                      className="border-0"
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
                  {row.getVisibleCells().map((cell) => {
                    const isNumeric = cell.column.columnDef.meta?.numeric === true;
                    return (
                      <TableCell
                        key={cell.id}
                        data-numeric={isNumeric || undefined}
                        className={cn(isNumeric && 'text-right')}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * Extend TanStack's ColumnMeta so `meta: { numeric: true }` type-checks
 * and drives right-alignment + tabular-nums styling via data attributes.
 */
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    numeric?: boolean;
  }
}
