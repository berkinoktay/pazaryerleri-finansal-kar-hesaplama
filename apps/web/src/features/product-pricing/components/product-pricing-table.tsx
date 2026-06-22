'use client';

import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import { Tag01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { ImageCell } from '@/components/patterns/image-cell';
import { Button } from '@/components/ui/button';

import type { ProductPricingItem } from '../api/list-product-pricing.api';
import type { ProductPricingSort } from '../query-keys';

import { LabeledIdentifier } from './labeled-identifier';
import { PricingStatusChip } from './pricing-status-chip';

const EMPTY_VALUE = '—';

interface ProductPricingTableProps {
  rows: ProductPricingItem[];
  sortBy: ProductPricingSort;
  loading: boolean;
  /** First-run empty (store connected, no approved products). */
  empty?: React.ReactNode;
  /** No-results empty (sort/filter narrowed the set to zero). */
  noResultsState?: React.ReactNode;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  error?: boolean;
  onRetry?: () => void;
  /** Fires with the row's variantId — carried to the future pricing panel. */
  onPriceRow: (variantId: string) => void;
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  onPaginationChange: (next: { page: number; perPage: number }) => void;
  onSortChange: (next: ProductPricingSort) => void;
}

/**
 * Money / percent cell. Null (uncostable row) renders the em-dash so the
 * column stays scannable. Money fields are GROSS decimal strings computed
 * server-side; the frontend only renders them.
 */
function NumericCell({ value }: { value: string | null }): React.ReactElement {
  if (value === null) {
    return <span className="text-muted-foreground-dim text-sm tabular-nums">{EMPTY_VALUE}</span>;
  }
  return <Currency value={value} className="text-sm" />;
}

function PercentCell({ value }: { value: string | null }): React.ReactElement {
  if (value === null) {
    return <span className="text-muted-foreground-dim text-sm tabular-nums">{EMPTY_VALUE}</span>;
  }
  return <span className="text-foreground text-sm tabular-nums">{value}%</span>;
}

// Backend sort key ↔ TanStack column id. The percentage / profit columns
// are sortable too — the API supports all five keys.
const SORTABLE_COLUMNS = new Set<string>([
  'title',
  'salePrice',
  'netProfit',
  'saleMarginPct',
  'costMarkupPct',
]);

function parseSort(sort: ProductPricingSort): { column: string; desc: boolean } {
  const [column, direction] = sort.split(':');
  return { column, desc: direction === 'desc' };
}

/**
 * Image-forward media-row table for forward pricing. Each row leads with a
 * prominent product image, then the name + sku/barcode identifiers, then the
 * right-aligned numeric columns (sale / cost / profit / markup / margin), the
 * status chip, and the "Fiyatla" stub action.
 *
 * Sorting + pagination are server-side: the table projects the backend sort
 * into TanStack's SortingState and forwards click intent back up; the page
 * client owns the URL state via nuqs.
 */
export function ProductPricingTable({
  rows,
  sortBy,
  loading,
  empty,
  noResultsState,
  hasActiveFilters,
  onClearFilters,
  error,
  onRetry,
  onPriceRow,
  page,
  perPage,
  total,
  totalPages,
  onPaginationChange,
  onSortChange,
}: ProductPricingTableProps): React.ReactElement {
  const t = useTranslations('features.productPricing');
  const tIdentifiers = useTranslations('features.productPricing.identifiers');

  const columns = React.useMemo<ColumnDef<ProductPricingItem>[]>(() => {
    const productColumn: ColumnDef<ProductPricingItem> = {
      // id matches the backend `title` sort key so the header toggle
      // round-trips. accessorFn is a no-op contract requirement —
      // TanStack only unlocks the sort button when a column declares an
      // accessor; ordering is server-driven so the value is never used.
      id: 'title',
      accessorFn: (row) => row.productName,
      header: () => t('columns.product'),
      meta: { label: t('columns.product') },
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="gap-sm flex items-center">
            <ImageCell src={item.imageUrl} alt={item.productName} size="lg" />
            <div className="gap-3xs flex min-w-0 flex-col">
              <span className="text-foreground line-clamp-1 text-sm font-medium">
                {item.productName}
              </span>
              <div className="gap-x-sm gap-y-3xs flex min-w-0 flex-wrap items-baseline">
                <LabeledIdentifier label={tIdentifiers('sku')} value={item.sku} />
                <LabeledIdentifier label={tIdentifiers('barcode')} value={item.barcode} />
              </div>
            </div>
          </div>
        );
      },
      enableSorting: true,
    };

    const salePriceColumn: ColumnDef<ProductPricingItem> = {
      id: 'salePrice',
      accessorKey: 'salePrice',
      header: () => t('columns.salePrice'),
      meta: { numeric: true, label: t('columns.salePrice') },
      cell: ({ row }) => <NumericCell value={row.original.salePrice} />,
      enableSorting: true,
    };

    const costColumn: ColumnDef<ProductPricingItem> = {
      id: 'cost',
      accessorKey: 'cost',
      header: () => t('columns.cost'),
      meta: { numeric: true, label: t('columns.cost') },
      cell: ({ row }) => <NumericCell value={row.original.cost} />,
      enableSorting: false,
    };

    const netProfitColumn: ColumnDef<ProductPricingItem> = {
      id: 'netProfit',
      accessorKey: 'netProfit',
      header: () => t('columns.netProfit'),
      meta: { numeric: true, label: t('columns.netProfit') },
      cell: ({ row }) => <NumericCell value={row.original.netProfit} />,
      enableSorting: true,
    };

    const costMarkupColumn: ColumnDef<ProductPricingItem> = {
      id: 'costMarkupPct',
      accessorKey: 'costMarkupPct',
      header: () => t('columns.costMarkupPct'),
      meta: { numeric: true, label: t('columns.costMarkupPct') },
      cell: ({ row }) => <PercentCell value={row.original.costMarkupPct} />,
      enableSorting: true,
    };

    const saleMarginColumn: ColumnDef<ProductPricingItem> = {
      id: 'saleMarginPct',
      accessorKey: 'saleMarginPct',
      header: () => t('columns.saleMarginPct'),
      meta: { numeric: true, label: t('columns.saleMarginPct') },
      cell: ({ row }) => <PercentCell value={row.original.saleMarginPct} />,
      enableSorting: true,
    };

    const statusColumn: ColumnDef<ProductPricingItem> = {
      id: 'status',
      header: () => t('columns.status'),
      meta: { label: t('columns.status') },
      cell: ({ row }) => <PricingStatusChip item={row.original} />,
      enableSorting: false,
    };

    const actionColumn: ColumnDef<ProductPricingItem> = {
      id: 'actions',
      header: () => <span className="sr-only">{t('action.price')}</span>,
      meta: { label: t('action.price') },
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            data-row-action
            aria-label={t('action.ariaLabel')}
            onClick={() => onPriceRow(row.original.variantId)}
          >
            <Tag01Icon aria-hidden className="size-icon-xs" />
            {t('action.price')}
          </Button>
        </div>
      ),
      enableSorting: false,
    };

    return [
      productColumn,
      salePriceColumn,
      costColumn,
      netProfitColumn,
      costMarkupColumn,
      saleMarginColumn,
      statusColumn,
      actionColumn,
    ];
  }, [onPriceRow, t, tIdentifiers]);

  const sortingState: SortingState = React.useMemo(() => {
    const parsed = parseSort(sortBy);
    return [{ id: parsed.column, desc: parsed.desc }];
  }, [sortBy]);

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

  // Translate TanStack's column toggle into our `sortBy` vocabulary.
  // Default direction on first click is ascending; a second click flips
  // to descending (TanStack hands us the next desc flag).
  const handleSortingChange = React.useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      const next = typeof updater === 'function' ? updater(sortingState) : updater;
      const head = next[0];
      if (head === undefined || !SORTABLE_COLUMNS.has(head.id)) return;
      const direction = head.desc ? 'desc' : 'asc';
      onSortChange(`${head.id}:${direction}` as ProductPricingSort);
    },
    [onSortChange, sortingState],
  );

  return (
    <DataTable<ProductPricingItem, unknown>
      columns={columns}
      data={rows}
      loading={loading}
      empty={empty}
      noResultsState={noResultsState}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      error={error}
      onRetry={onRetry}
      pagination={(table) => <DataTablePagination table={table} pageSizes={[10, 25, 50, 100]} />}
      sorting={sortingState}
      onSortingChange={handleSortingChange}
      paginationState={paginationState}
      onPaginationChange={handlePaginationChange}
      pageCount={totalPages}
      rowCount={total}
      getRowId={(row) => row.variantId}
    />
  );
}
