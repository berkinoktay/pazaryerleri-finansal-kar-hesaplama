'use client';

import { type Table } from '@tanstack/react-table';
import {
  ArrowLeft01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
} from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;

export interface DataTablePaginationProps<TData> {
  /** TanStack table instance — fed by DataTable's `pagination` slot. */
  table: Table<TData>;
  /** Choices for the per-page Select. Defaults to [10, 25, 50, 100]. */
  pageSizes?: readonly number[];
  className?: string;
}

/**
 * Pagination footer for DataTable. Renders a left-aligned rows summary
 * ("11–25 / 1.472 satır", hidden on narrow viewports), a per-page Select,
 * a "Sayfa X / Y" caption, and first / previous / next / last navigation
 * buttons. All numbers route through `useFormatter().number` so locale
 * grouping (`tr-TR` → `1.472`) works out of the box; copy comes from
 * `common.dataTable.pagination.*`.
 *
 * Server-side aware. The component reads from the table instance only —
 * `table.getRowCount()`, `table.getPageCount()`, `table.getCanNextPage()`,
 * `table.firstPage()`, etc. When the parent wires `manualPagination: true`
 * + `rowCount` / `pageCount` on the TanStack config, the same UI works
 * unchanged. Pair with DataTable's `pagination` slot:
 *
 *     <DataTable
 *       columns={cols}
 *       data={rows}
 *       pagination={(t) => <DataTablePagination table={t} />}
 *     />
 *
 * Always renders, even when there's nothing to paginate — provides visual
 * stability and keeps the per-page Select reachable for empty filters.
 *
 * @useWhen mounting the standard pagination footer beneath a DataTable (works for both client-side TanStack pagination and server-side controlled pagination — the wrapping DataTable decides the mode)
 */
export function DataTablePagination<TData>({
  table,
  pageSizes = DEFAULT_PAGE_SIZES,
  className,
}: DataTablePaginationProps<TData>): React.ReactElement {
  const t = useTranslations('common.dataTable.pagination');
  const formatter = useFormatter();

  const { pageIndex, pageSize } = table.getState().pagination;
  // pageCount can be 0 when nothing matches the filter — clamp to 1 so
  // the "Page X of Y" caption stays sensible ("Sayfa 1 / 1") rather than
  // "Sayfa 1 / 0".
  const pageCount = Math.max(table.getPageCount(), 1);
  const totalRows = table.getRowCount();
  const rowsOnPage = table.getRowModel().rows.length;
  // 1-indexed display: "11–25 / 1.472" not "10–24 / 1.472".
  const firstRow = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = pageIndex * pageSize + rowsOnPage;
  const currentPage = Math.min(pageIndex + 1, pageCount);

  const rowsLabel = t('rowsOf', {
    shown:
      totalRows === 0
        ? formatter.number(0, 'integer')
        : `${formatter.number(firstRow, 'integer')}–${formatter.number(lastRow, 'integer')}`,
    total: formatter.number(totalRows, 'integer'),
  });

  return (
    <nav
      aria-label={t('pageOf', {
        page: formatter.number(currentPage, 'integer'),
        total: formatter.number(pageCount, 'integer'),
      })}
      className={cn('gap-md flex flex-wrap items-center justify-between', className)}
    >
      <span className="text-2xs text-muted-foreground hidden tabular-nums sm:inline">
        {rowsLabel}
      </span>

      <div className="gap-md flex flex-wrap items-center">
        <div className="gap-xs flex items-center">
          <span className="text-2xs text-muted-foreground hidden sm:inline">
            {t('rowsPerPage')}
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger size="sm" className="w-pagesize-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-2xs text-muted-foreground tabular-nums">
          {t('pageOf', {
            page: formatter.number(currentPage, 'integer'),
            total: formatter.number(pageCount, 'integer'),
          })}
        </span>

        <div className="gap-3xs flex items-center">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.firstPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label={t('first')}
          >
            <ArrowLeftDoubleIcon className="size-icon-sm" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label={t('previous')}
          >
            <ArrowLeft01Icon className="size-icon-sm" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label={t('next')}
          >
            <ArrowRight01Icon className="size-icon-sm" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.lastPage()}
            disabled={!table.getCanNextPage()}
            aria-label={t('last')}
          >
            <ArrowRightDoubleIcon className="size-icon-sm" />
          </Button>
        </div>
      </div>
    </nav>
  );
}
