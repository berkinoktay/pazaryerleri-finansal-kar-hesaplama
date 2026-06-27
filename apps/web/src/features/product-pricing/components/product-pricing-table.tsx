'use client';

import type { ColumnDef, PaginationState, Row, SortingState } from '@tanstack/react-table';
import { Tag01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { ImageCell } from '@/components/patterns/image-cell';
import { Button } from '@/components/ui/button';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { marginColorStyle } from '@/lib/margin-color-style';
import type { MarginScale } from '@/lib/margin-coloring';
import { useCurrentScope } from '@/providers/current-scope';

import type { ProductPricingItem } from '../api/list-product-pricing.api';
import { canWriteMarketplacePrice } from '../lib/can-write-price';
import type { ProductPricingSort } from '../query-keys';
import { formatPercentDisplay } from '../lib/format-percent';

import { LabeledIdentifier } from './labeled-identifier';
import { PricingCalculator } from './pricing-calculator';

const EMPTY_VALUE = '—';

interface ProductPricingTableProps {
  rows: ProductPricingItem[];
  sortBy: ProductPricingSort;
  loading: boolean;
  /** Org/store context for the inline calculator (quote endpoint). */
  orgId: string;
  storeId: string;
  /**
   * Viewport mode from `useIsMobile()`. Desktop opens the calculator inline
   * under the row (DataTable expand); mobile opens it in a Sheet via
   * `onOpenPanel`. Rows are only expandable on desktop.
   */
  isMobile: boolean;
  /** Search + facet + margin filter row, mounted in the toolbar zone. */
  toolbar?: React.ReactNode;
  /** First-run empty (store connected, no approved products). */
  empty?: React.ReactNode;
  /** No-results empty (sort/filter narrowed the set to zero). */
  noResultsState?: React.ReactNode;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  error?: boolean;
  onRetry?: () => void;
  /** Mobile-only: opens the pricing Sheet for the row. */
  onOpenPanel: (item: ProductPricingItem) => void;
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

function PercentCell({
  value,
  marginScale,
}: {
  value: string | null;
  /** When provided, applies margin coloring via marginColorStyle (margin % column only). */
  marginScale?: MarginScale | null;
}): React.ReactElement {
  if (value === null) {
    return <span className="text-muted-foreground-dim text-sm tabular-nums">{EMPTY_VALUE}</span>;
  }
  // OFF: original colorless appearance (no className).
  // ON: inline color from the bucket (style overrides the default foreground).
  // marginScale === undefined means the prop was not passed (non-margin columns) — no style.
  const colorStyle = marginScale !== undefined ? marginColorStyle(value, marginScale) : undefined;
  return (
    <span className="text-foreground text-sm tabular-nums" style={colorStyle}>
      {formatPercentDisplay(value)}
    </span>
  );
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
 * status chip, and the "Fiyatla" action. The toolbar slot carries the
 * search + facet + margin-range + loss-only filters.
 *
 * "Fiyatla" opens the pricing calculator as a responsive hybrid: on desktop it
 * expands inline under the row (DataTable `renderSubComponent`), on mobile it
 * routes up to a Sheet via `onOpenPanel`. One `PricingCalculator` is reused in
 * both shells.
 *
 * Sorting + pagination are server-side: the table projects the backend sort
 * into TanStack's SortingState and forwards click intent back up; the page
 * client owns the URL state via nuqs.
 */
export function ProductPricingTable({
  rows,
  sortBy,
  loading,
  orgId,
  storeId,
  isMobile,
  toolbar,
  empty,
  noResultsState,
  hasActiveFilters,
  onClearFilters,
  error,
  onRetry,
  onOpenPanel,
  page,
  perPage,
  total,
  totalPages,
  onPaginationChange,
  onSortChange,
}: ProductPricingTableProps): React.ReactElement {
  const t = useTranslations('features.productPricing');
  const tIdentifiers = useTranslations('features.productPricing.identifiers');

  // Live price write is OWNER/ADMIN-only — gate the inline calculator's save
  // action as UX (the backend enforces the same rule and 403s otherwise).
  const { role } = useCurrentScope();
  const canWritePrice = canWriteMarketplacePrice(role);
  // Read once at the component level — never inside cell render functions.
  const scale = useMarginColoring();

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
      // Scale threaded via closure — scale is captured from the enclosing useMemo scope.
      cell: ({ row }) => <PercentCell value={row.original.saleMarginPct} marginScale={scale} />,
      enableSorting: true,
    };

    const actionColumn: ColumnDef<ProductPricingItem> = {
      id: 'actions',
      header: () => <span className="sr-only">{t('action.price')}</span>,
      meta: { label: t('action.price') },
      cell: ({ row }) => {
        // Mobile → Sheet (parent owns the open state). Desktop → toggle the
        // inline row-expand, so a second click collapses it.
        const handleClick = (): void => {
          if (isMobile) {
            onOpenPanel(row.original);
            return;
          }
          row.toggleExpanded();
        };
        return (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              data-row-action
              aria-label={t('action.ariaLabel')}
              aria-expanded={isMobile ? undefined : row.getIsExpanded()}
              onClick={handleClick}
            >
              <Tag01Icon aria-hidden className="size-icon-xs" />
              {t('action.price')}
            </Button>
          </div>
        );
      },
      enableSorting: false,
    };

    return [
      productColumn,
      salePriceColumn,
      costColumn,
      netProfitColumn,
      costMarkupColumn,
      saleMarginColumn,
      actionColumn,
    ];
  }, [isMobile, onOpenPanel, t, tIdentifiers, scale]);

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

  // Desktop only: rows expand to mount the calculator inline; on mobile the
  // calculator lives in a Sheet, so rows stay non-expandable.
  const getRowCanExpand = React.useCallback(() => !isMobile, [isMobile]);

  const renderSubComponent = React.useCallback(
    (row: Row<ProductPricingItem>): React.ReactNode => (
      <div className="bg-surface-subtle p-lg">
        <PricingCalculator
          item={row.original}
          orgId={orgId}
          storeId={storeId}
          canWritePrice={canWritePrice}
          onClose={() => row.toggleExpanded(false)}
        />
      </div>
    ),
    [orgId, storeId, canWritePrice],
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
      toolbar={toolbar !== undefined ? () => toolbar : undefined}
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
      getRowCanExpand={getRowCanExpand}
      renderSubComponent={renderSubComponent}
    />
  );
}
