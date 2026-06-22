'use client';

import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import { Tag01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { ImageCell } from '@/components/patterns/image-cell';
import { MappedBadge } from '@/components/patterns/mapped-badge';
import { Button } from '@/components/ui/button';
import { type BadgeProps } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { ProductPricingItem } from '../api/list-product-pricing.api';
import { resolvePricingStatus, type PricingStatusKind } from '../lib/pricing-status';
import type { ProductPricingSort } from '../query-keys';

const EMPTY_VALUE = '—';

/** Pricing status chip → Badge tone. `ready` reads success; each gap reads warning. */
const STATUS_TONE: Record<PricingStatusKind, BadgeProps['tone']> = {
  ready: 'success',
  cost: 'warning',
  shipping: 'warning',
  commission: 'warning',
};

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

/** Status chip + tooltip carrying the precise sub-status reason. */
function PricingStatusCell({ item }: { item: ProductPricingItem }): React.ReactElement {
  const t = useTranslations('features.productPricing.status');
  // Group-scoped translators keep the sub-status enum value a statically
  // typed message key (no dynamic dotted lookup): the API enum members
  // line up 1:1 with the keys under each detail group.
  const tCost = useTranslations('features.productPricing.status.detail.cost');
  const tShipping = useTranslations('features.productPricing.status.detail.shipping');
  const tCommission = useTranslations('features.productPricing.status.detail.commission');
  const descriptor = resolvePricingStatus(item);

  const labelMap: Record<PricingStatusKind, React.ReactNode> = {
    ready: t('ready'),
    cost: t('cost'),
    shipping: t('shipping'),
    commission: t('commission'),
  };

  const detail =
    descriptor.kind === 'ready'
      ? tCost('OK')
      : descriptor.group === 'cost'
        ? tCost(descriptor.detail)
        : descriptor.group === 'shipping'
          ? tShipping(descriptor.detail)
          : tCommission(descriptor.detail);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Span (not button): this cell may sit inside a clickable row later;
            role/tabIndex keep it focusable so the tooltip opens on keyboard
            focus without nesting a button. */}
        <span
          className="inline-flex cursor-help"
          data-row-action
          tabIndex={0}
          role="button"
          aria-label={t('ariaLabel')}
        >
          <MappedBadge<PricingStatusKind>
            value={descriptor.kind}
            toneMap={STATUS_TONE}
            labelMap={labelMap}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent align="start" className="max-w-input-narrow">
        {detail}
      </TooltipContent>
    </Tooltip>
  );
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
              <span className="text-muted-foreground text-2xs gap-2xs flex min-w-0 items-center">
                <span className="truncate tabular-nums">{item.sku}</span>
                <span aria-hidden className="text-muted-foreground-dim">
                  ·
                </span>
                <span className="truncate tabular-nums">{item.barcode}</span>
              </span>
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
      cell: ({ row }) => <PricingStatusCell item={row.original} />,
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
  }, [onPriceRow, t]);

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
