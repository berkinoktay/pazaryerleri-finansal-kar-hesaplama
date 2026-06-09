'use client';

import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import { InformationCircleIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DefinitionList } from '@/components/patterns/definition-list';
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
  /** Rule-kind FilterTabs strip, mounted in the integrated panel's top zone. */
  tabs?: React.ReactNode;
  toolbar?: React.ReactNode;
  /** First-run empty (no tariff loaded yet). */
  empty?: React.ReactNode;
  /** No-results empty (search / scope narrowed the set to zero). */
  noResultsState?: React.ReactNode;
  /** True when search or scope filter is active — drives the no-results vs first-run split. */
  hasActiveFilters?: boolean;
  /** Clears search + scope; wires the no-results state's reset button. */
  onClearFilters?: () => void;
  /** Renders an in-table error state with a retry button. */
  error?: boolean;
  onRetry?: () => void;
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
 * The commission rate value cell. Renders the base rate as a value-first
 * figure; when the row carries segment overrides (Trendyol tier rates),
 * the figure becomes a hover/focus trigger that reveals the tier breakdown
 * as a `DefinitionList` — the showcase-documented use for a commission
 * breakdown. No overrides → a plain figure (no trigger).
 */
function BaseRateCell({ item }: { item: CommissionRateListItem }): React.ReactElement {
  const t = useTranslations('features.commissionRates');
  const formatter = useFormatter();

  const value = formatter.number(Number.parseFloat(item.baseRate) / 100, 'percent');
  const entries = orderedSegmentEntries(item.segmentOverrides);

  if (entries.length === 0) {
    return <span className="text-foreground text-sm font-semibold tabular-nums">{value}</span>;
  }

  const tierItems = entries.map((entry) => ({
    id: entry.key,
    term: entry.label,
    description: formatter.number(Number.parseFloat(entry.value) / 100, 'percent'),
  }));

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Span (not button): this cell may later sit inside a clickable row,
            and a real button would nest. role/tabIndex keep it focusable so the
            tooltip opens on keyboard focus. */}
        <span
          className="text-foreground gap-3xs inline-flex cursor-help items-center text-sm font-semibold tabular-nums"
          data-row-action
          tabIndex={0}
          role="button"
        >
          {value}
          <InformationCircleIcon className="size-icon-xs text-muted-foreground-dim" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent align="end" className="max-w-input-narrow">
        <div className="gap-2xs flex flex-col">
          <span className="text-2xs text-muted-foreground font-medium">
            {t('tooltip.segmentOverridesTitle')}
          </span>
          <DefinitionList items={tierItems} dense alignRight />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Commission-rates DataTable. Two column shapes selected by ruleKind:
 * CATEGORY consolidates the parent category into a two-line cell under the
 * category name; CATEGORY_BRAND keeps brand + category as sibling columns.
 *
 * Sorting + pagination are server-side: the table forwards click intent to
 * `resolveSortIntent` and bubbles the resolved (sort, productScope,
 * autoSwitchedScope) tuple up — the parent handles the URL state update,
 * the auto-switch toast, and the page slice via nuqs.
 */
export function CommissionRatesTable({
  rows,
  ruleKind,
  productScope,
  sort,
  loading,
  tabs,
  toolbar,
  empty,
  noResultsState,
  hasActiveFilters,
  onClearFilters,
  error,
  onRetry,
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
    // CATEGORY mode — category name with its parent as a quiet second line.
    const categoryWithParentColumn: ColumnDef<CommissionRateListItem> = {
      id: 'categoryName',
      accessorKey: 'categoryName',
      header: () => t('columns.category'),
      meta: { label: t('columns.category') },
      cell: ({ row }) => (
        <div className="gap-3xs flex min-w-0 flex-col">
          <span className="text-foreground truncate text-sm font-medium">
            {row.original.categoryName}
          </span>
          {row.original.parentCategoryName !== null ? (
            <span className="text-muted-foreground text-2xs truncate">
              {row.original.parentCategoryName}
            </span>
          ) : null}
        </div>
      ),
      enableSorting: true,
    };

    // CATEGORY_BRAND mode — brand is the row's identity, category is a
    // sortable companion column.
    const brandColumn: ColumnDef<CommissionRateListItem> = {
      id: 'brandName',
      header: () => t('columns.brand'),
      meta: { label: t('columns.brand') },
      cell: ({ row }) => (
        <span className="text-foreground text-sm font-medium">{row.original.brandName ?? '—'}</span>
      ),
      enableSorting: false,
    };

    const categoryColumn: ColumnDef<CommissionRateListItem> = {
      id: 'categoryName',
      accessorKey: 'categoryName',
      header: () => t('columns.category'),
      meta: { label: t('columns.category') },
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">{row.original.categoryName}</span>
      ),
      enableSorting: true,
    };

    const baseRateColumn: ColumnDef<CommissionRateListItem> = {
      id: 'baseRate',
      accessorKey: 'baseRate',
      header: () => t('columns.baseRate'),
      meta: { numeric: true, label: t('columns.baseRate') },
      cell: ({ row }) => <BaseRateCell item={row.original} />,
      enableSorting: true,
    };

    const paymentTermColumn: ColumnDef<CommissionRateListItem> = {
      id: 'paymentTermDays',
      accessorKey: 'paymentTermDays',
      header: () => t('columns.paymentTermDays'),
      meta: { numeric: true, label: t('columns.paymentTermDays') },
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm tabular-nums">
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
          {/*
            Span (not InfoHint's <button>): this header is sortable, so
            DataTable wraps its whole content in a <button>. A nested button
            is invalid HTML and breaks hydration — so the hint trigger stays a
            role="button" span, focusable for keyboard users, opening the
            tooltip on focus.
          */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                role="button"
                aria-label={t('columns.productCountHint')}
                data-row-action
                className="text-muted-foreground-dim hover:text-muted-foreground inline-flex cursor-help items-center transition-colors"
              >
                <InformationCircleIcon className="size-icon-xs" aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent align="end" className="max-w-input-narrow">
              {t('columns.productCountHint')}
            </TooltipContent>
          </Tooltip>
        </span>
      ),
      meta: { numeric: true, label: t('columns.productCount') },
      cell: ({ row }) => (
        <span
          className={cn(
            'text-sm tabular-nums',
            row.original.productCount > 0
              ? 'text-foreground font-medium'
              : 'text-muted-foreground-dim',
          )}
        >
          {formatter.number(row.original.productCount, 'integer')}
        </span>
      ),
      enableSorting: true,
    };

    return ruleKind === 'CATEGORY'
      ? [categoryWithParentColumn, baseRateColumn, paymentTermColumn, productCountColumn]
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
      tabs={tabs}
      empty={empty}
      noResultsState={noResultsState}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      error={error}
      onRetry={onRetry}
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
