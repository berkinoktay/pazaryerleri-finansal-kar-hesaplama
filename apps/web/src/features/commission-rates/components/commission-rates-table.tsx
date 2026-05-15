'use client';

import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import { InformationCircleIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { CommissionRateListItem } from '../api/list-commission-rates.api';
import { orderedSegmentEntries } from '../lib/segment-labels';
import { parseSort, resolveSortIntent, type SortableColumn } from '../lib/sort-options';
import type {
  CommissionRateProductScope,
  CommissionRateRuleKind,
  CommissionRateSort,
} from '../query-keys';

interface CommissionRatesTableProps {
  rows: CommissionRateListItem[];
  ruleKind: CommissionRateRuleKind;
  productScope: CommissionRateProductScope;
  sort: CommissionRateSort;
  loading: boolean;
  empty?: React.ReactNode;
  toolbar?: React.ReactNode;
  // Pagination state — controlled by the page client via nuqs
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  onPaginationChange: (next: { page: number; perPage: number }) => void;
  onSortChange: (next: {
    sort: CommissionRateSort;
    productScope: CommissionRateProductScope;
    autoSwitchedScope: boolean;
  }) => void;
}

/**
 * Commission-rates DataTable. Two column shapes selected by ruleKind
 * (CATEGORY shows parentCategoryName; CATEGORY_BRAND shows brandName).
 * Sorting is server-side: the table forwards click intent to
 * `resolveSortIntent` and bubbles the resolved (sort, productScope,
 * autoSwitchedScope) tuple up — the parent handles the URL state
 * update + the auto-switch toast.
 * Pagination is also server-side: `page`/`perPage`/`total`/`totalPages` are
 * controlled by the page client via nuqs and forwarded to TanStack's
 * `manualPagination` mode.
 */
export function CommissionRatesTable({
  rows,
  ruleKind,
  productScope,
  sort,
  loading,
  empty,
  toolbar,
  page,
  perPage,
  total,
  totalPages,
  onPaginationChange,
  onSortChange,
}: CommissionRatesTableProps): React.ReactElement {
  const t = useTranslations('features.commissionRates');
  const formatter = useFormatter();

  const columns = React.useMemo<ColumnDef<CommissionRateListItem>[]>(() => {
    const categoryColumn: ColumnDef<CommissionRateListItem> = {
      id: 'categoryName',
      accessorKey: 'categoryName',
      header: () => t('columns.category'),
      cell: ({ row }) => (
        <span className="text-foreground text-sm">{row.original.categoryName}</span>
      ),
      enableSorting: true,
    };

    const parentCategoryColumn: ColumnDef<CommissionRateListItem> = {
      id: 'parentCategoryName',
      header: () => t('columns.parentCategory'),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.parentCategoryName ?? '—'}
        </span>
      ),
      enableSorting: false,
    };

    const brandColumn: ColumnDef<CommissionRateListItem> = {
      id: 'brandName',
      header: () => t('columns.brand'),
      cell: ({ row }) => (
        <span className="text-foreground text-sm">{row.original.brandName ?? '—'}</span>
      ),
      enableSorting: false,
    };

    const baseRateColumn: ColumnDef<CommissionRateListItem> = {
      id: 'baseRate',
      accessorKey: 'baseRate',
      header: () => t('columns.baseRate'),
      meta: { numeric: true },
      cell: ({ row }) => {
        const overrides = row.original.segmentOverrides;
        const entries = orderedSegmentEntries(overrides);
        const value = formatter.number(Number.parseFloat(row.original.baseRate) / 100, 'percent');
        if (entries.length === 0) {
          return <span className="text-foreground text-sm tabular-nums">{value}</span>;
        }
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="text-foreground gap-3xs inline-flex items-center text-sm tabular-nums"
                data-row-action
                tabIndex={0}
                role="button"
              >
                {value}
                <InformationCircleIcon className="size-icon-xs text-muted-foreground" />
              </span>
            </TooltipTrigger>
            <TooltipContent align="end" className="max-w-input-narrow">
              <div className="gap-3xs flex flex-col">
                <span className="text-2xs text-muted-foreground">
                  {t('tooltip.segmentOverridesTitle')}
                </span>
                <ul className="gap-3xs flex flex-col">
                  {entries.map((entry) => (
                    <li
                      key={entry.key}
                      className="gap-sm text-2xs flex items-center justify-between tabular-nums"
                    >
                      <span className="text-muted-foreground">{entry.label}</span>
                      <span className="text-foreground">
                        {formatter.number(Number.parseFloat(entry.value) / 100, 'percent')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </TooltipContent>
          </Tooltip>
        );
      },
      enableSorting: true,
    };

    const paymentTermColumn: ColumnDef<CommissionRateListItem> = {
      id: 'paymentTermDays',
      accessorKey: 'paymentTermDays',
      header: () => t('columns.paymentTermDays'),
      meta: { numeric: true },
      cell: ({ row }) => (
        <span className="text-foreground text-sm tabular-nums">
          {t('tooltip.paymentTermDaysSuffix', {
            days: formatter.number(row.original.paymentTermDays, 'integer'),
          })}
        </span>
      ),
      enableSorting: false,
    };

    const productCountColumn: ColumnDef<CommissionRateListItem> = {
      id: 'productCount',
      accessorKey: 'productCount',
      header: () => (
        <span className="gap-3xs inline-flex items-center">
          {t('columns.productCount')}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                role="button"
                aria-label={t('columns.productCountHint')}
                data-row-action
                className="inline-flex items-center"
              >
                <InformationCircleIcon className="size-icon-xs text-muted-foreground" />
              </span>
            </TooltipTrigger>
            <TooltipContent align="end" className="max-w-input-narrow">
              {t('columns.productCountHint')}
            </TooltipContent>
          </Tooltip>
        </span>
      ),
      meta: { numeric: true },
      cell: ({ row }) => (
        <span
          className={cn(
            'text-sm tabular-nums',
            row.original.productCount > 0 ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {formatter.number(row.original.productCount, 'integer')}
        </span>
      ),
      enableSorting: true,
    };

    return ruleKind === 'CATEGORY'
      ? [
          categoryColumn,
          parentCategoryColumn,
          baseRateColumn,
          paymentTermColumn,
          productCountColumn,
        ]
      : [brandColumn, categoryColumn, baseRateColumn, paymentTermColumn, productCountColumn];
  }, [formatter, ruleKind, t]);

  // Project the backend sort into TanStack's SortingState so the
  // header arrows render in sync with URL state.
  const sortingState: SortingState = React.useMemo(() => {
    const parsed = parseSort(sort);
    return [{ id: parsed.column, desc: parsed.direction === 'desc' }];
  }, [sort]);

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

  // Translate TanStack's column toggle event into our sort vocabulary.
  // TanStack hands us the next SortingState; we read the first entry's
  // id and delegate to resolveSortIntent for the auto-switch math.
  const handleSortingChange = React.useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      const next = typeof updater === 'function' ? updater(sortingState) : updater;
      const head = next[0];
      if (head === undefined) return;
      const column = head.id as SortableColumn;
      onSortChange(resolveSortIntent({ column, currentSort: sort, productScope }));
    },
    [onSortChange, productScope, sort, sortingState],
  );

  return (
    <DataTable<CommissionRateListItem, unknown>
      columns={columns}
      data={rows}
      loading={loading}
      empty={empty}
      toolbar={toolbar !== undefined ? () => toolbar : undefined}
      pagination={(table) => <DataTablePagination table={table} pageSizes={[10, 25, 50, 100]} />}
      sorting={sortingState}
      onSortingChange={handleSortingChange}
      paginationState={paginationState}
      onPaginationChange={handlePaginationChange}
      pageCount={totalPages}
      rowCount={total}
      getRowId={(row) => row.id}
    />
  );
}
