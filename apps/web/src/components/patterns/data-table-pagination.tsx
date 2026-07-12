'use client';

import { type Table } from '@tanstack/react-table';
import { ArrowLeft01Icon, ArrowRight01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { DataTableLoadingContext } from '@/components/patterns/data-table';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getPaginationRange } from '@/lib/pagination-range';
import { cn } from '@/lib/utils';

// Top option capped at 50: the body is paginated, NOT virtualized, so an
// un-windowed page of 100 rows (multiplied further by expandable sub-rows) is
// where a large grid starts to jank. The scaling strategy is paginate — reserve
// virtualization for a future un-paginated feed, where it can be opt-in without
// fighting the sticky header, spanning sub-rows, and pinned columns.
const DEFAULT_PAGE_SIZES = [10, 25, 50] as const;

export interface DataTablePaginationProps<TData> {
  /** TanStack table instance — fed by DataTable's `pagination` slot. */
  table: Table<TData>;
  /** Choices for the per-page Select. Defaults to [10, 25, 50]. */
  pageSizes?: readonly number[];
  /**
   * Optional muted trace rendered beside the rows summary (e.g. a "Son
   * güncelleme" freshness note). Shares the rows-summary's narrow-viewport
   * hide behavior, so it never crowds the mobile footer.
   */
  leading?: React.ReactNode;
  className?: string;
}

/**
 * Pagination footer for DataTable. Left: a rows summary ("11–25 / 1.472 satır",
 * hidden on narrow viewports). Right: a per-page Select + a NUMBERED page strip
 * built on the shared `ui/pagination` primitive — prev · 1 … 4 5 6 … 20 · next,
 * the current page highlighted, collapsed runs shown as an ellipsis. On narrow
 * viewports the numbers collapse to a compact "Sayfa X / Y" caption between the
 * prev / next controls.
 *
 * All numbers route through `useFormatter().number` so locale grouping
 * (`tr-TR` → `1.472`) works; copy comes from `common.dataTable.pagination.*`
 * and `common.pagination.*`.
 *
 * Server-side aware: reads from the table instance only — `getRowCount()`,
 * `getPageCount()`, `getCanNextPage()`, `setPageIndex()`, etc. — so the same UI
 * works unchanged when the parent wires `manualPagination: true` + `rowCount` /
 * `pageCount`. Always renders (even with nothing to paginate) for visual
 * stability and to keep the per-page Select reachable.
 *
 * @useWhen mounting the standard pagination footer beneath a DataTable (works for both client-side TanStack pagination and server-side controlled pagination — the wrapping DataTable decides the mode)
 */
export function DataTablePagination<TData>({
  table,
  pageSizes = DEFAULT_PAGE_SIZES,
  leading,
  className,
}: DataTablePaginationProps<TData>): React.ReactElement {
  const t = useTranslations('common.dataTable.pagination');
  const tNav = useTranslations('common.pagination');
  const formatter = useFormatter();
  // While the body loads, the table instance reports 0 rows / 1 page as if
  // they were facts. Swap the figures for placeholders and hold navigation —
  // never assert numbers we don't have yet.
  const loading = React.useContext(DataTableLoadingContext);

  const { pageIndex, pageSize } = table.getState().pagination;
  // pageCount can be 0 when nothing matches the filter — clamp to 1 so the
  // strip always renders a single page rather than collapsing to nothing.
  const pageCount = Math.max(table.getPageCount(), 1);
  const totalRows = table.getRowCount();
  const rowsOnPage = table.getRowModel().rows.length;
  // 1-indexed display: "11–25 / 1.472" not "10–24 / 1.472".
  const firstRow = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = pageIndex * pageSize + rowsOnPage;
  const currentPage = Math.min(pageIndex + 1, pageCount);
  const canPrev = table.getCanPreviousPage();
  const canNext = table.getCanNextPage();
  const pageItems = getPaginationRange(currentPage, pageCount);

  const rowsLabel = t('rowsOf', {
    shown:
      totalRows === 0
        ? formatter.number(0, 'integer')
        : `${formatter.number(firstRow, 'integer')}–${formatter.number(lastRow, 'integer')}`,
    total: formatter.number(totalRows, 'integer'),
  });

  const pageOfLabel = t('pageOf', {
    page: formatter.number(currentPage, 'integer'),
    total: formatter.number(pageCount, 'integer'),
  });

  return (
    <div className={cn('gap-md flex flex-wrap items-center justify-between', className)}>
      {/* Left cluster: rows summary + optional leading trace. Hidden on narrow
          viewports (same as the standalone rows summary always was) so the
          footer never crowds under the pagination controls on mobile. */}
      <div className="gap-sm text-2xs text-muted-foreground hidden min-w-0 items-center tabular-nums sm:flex">
        <span>
          {loading ? <Skeleton className="inline-block h-3 w-24 align-middle" /> : rowsLabel}
        </span>
        {leading !== undefined ? <span className="min-w-0 truncate">{leading}</span> : null}
      </div>

      <div className="gap-md flex flex-wrap items-center">
        <div className="gap-xs flex items-center">
          <span className="text-2xs text-muted-foreground hidden sm:inline">
            {t('rowsPerPage')}
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => table.setPageSize(Number(value))}
            disabled={loading}
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

        <Pagination aria-label={pageOfLabel} className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              <PaginationLink
                aria-label={tNav('previousPage')}
                onClick={() => table.previousPage()}
                disabled={!canPrev || loading}
              >
                <ArrowLeft01Icon className="size-icon-sm" />
              </PaginationLink>
            </PaginationItem>

            {/* Narrow viewport: a compact caption instead of the full strip. */}
            <PaginationItem className="sm:hidden">
              <span className="px-sm text-2xs text-muted-foreground tabular-nums">
                {loading ? (
                  <Skeleton className="inline-block h-3 w-12 align-middle" />
                ) : (
                  pageOfLabel
                )}
              </span>
            </PaginationItem>

            {/* Wide viewport: numbered pages with collapsed-range ellipsis.
                While loading, a single placeholder holds the strip's spot —
                a confident lone "1" would be a guess, not a fact. */}
            {loading ? (
              <PaginationItem className="hidden sm:flex">
                <Skeleton className="mx-xs h-3 w-12" />
              </PaginationItem>
            ) : (
              pageItems.map((item) =>
                typeof item === 'number' ? (
                  <PaginationItem key={item} className="hidden sm:flex">
                    <PaginationLink
                      isActive={item === currentPage}
                      aria-label={tNav('page', { page: formatter.number(item, 'integer') })}
                      onClick={() => table.setPageIndex(item - 1)}
                    >
                      {formatter.number(item, 'integer')}
                    </PaginationLink>
                  </PaginationItem>
                ) : (
                  <PaginationItem key={item} className="hidden sm:flex">
                    <PaginationEllipsis />
                  </PaginationItem>
                ),
              )
            )}

            <PaginationItem>
              <PaginationLink
                aria-label={tNav('nextPage')}
                onClick={() => table.nextPage()}
                disabled={!canNext || loading}
              >
                <ArrowRight01Icon className="size-icon-sm" />
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
