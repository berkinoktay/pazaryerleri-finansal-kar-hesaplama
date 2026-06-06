'use client';

import { type ColumnDef, type Table as TanstackTable } from '@tanstack/react-table';
import {
  Alert02Icon,
  MedalFirstPlaceIcon,
  MedalSecondPlaceIcon,
  MedalThirdPlaceIcon,
} from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { CopyableValue } from '@/components/patterns/copyable-value';
import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { EmptyState } from '@/components/patterns/empty-state';
import { FilterTabs } from '@/components/patterns/filter-tabs';
import { ImageCell } from '@/components/patterns/image-cell';
import { Button } from '@/components/ui/button';
import { CostCellPopover } from '@/features/costs/components/cost-cell-popover';

import type { TodayProductRow } from '../api/get-live-today-products.api';
import { useLiveTodayProducts } from '../hooks/use-live-today-products';

type ProductsTab = 'all' | 'missing';

interface LiveTodayProductsProps {
  orgId: string;
  storeId: string;
}

/** Podium medal for ranks 1-3 (neutral tone — amber is reserved for the cost CTA). */
function medalForRank(rank: number): React.ComponentType<{ className?: string }> | null {
  switch (rank) {
    case 1:
      return MedalFirstPlaceIcon;
    case 2:
      return MedalSecondPlaceIcon;
    case 3:
      return MedalThirdPlaceIcon;
    default:
      return null;
  }
}

/**
 * "Bugün Sipariş Alan Ürünler" — one row per product variant that sold today,
 * merged over orders ∪ buffer. A single DataTable: client-side sort (default
 * units desc), a Tümü / Maliyet bekleyen tab, product-name search, and
 * pagination — the dataset is bounded to today's distinct products so it loads
 * fully. The Sıra column awards a neutral podium medal to the current-sort
 * top-3; the Maliyet column shows the quiet unit cost when costed, else an
 * inline "Maliyet Ekle" action (the existing variant-level CostCellPopover).
 * No per-product profit. Realtime invalidation (liveKeys.all) refetches on
 * order / buffer / cost changes.
 */
export function LiveTodayProducts({ orgId, storeId }: LiveTodayProductsProps): React.ReactElement {
  const t = useTranslations('livePerformance.todayProducts');
  const query = useLiveTodayProducts(orgId, storeId);
  // Stable reference (`?? []` makes a fresh array each render) so the derived
  // memos below don't recompute on every render.
  const queryRows = query.data?.data;
  const allRows = React.useMemo(() => queryRows ?? [], [queryRows]);

  const [tab, setTab] = React.useState<ProductsTab>('all');
  const [search, setSearch] = React.useState('');

  const missingCount = React.useMemo(
    () => allRows.filter((row) => row.costStatus === 'missing').length,
    [allRows],
  );

  // Tab + search filter the data array client-side (the table then sorts /
  // paginates the result). hasActiveFilters drives the empty-vs-no-results split.
  const rows = React.useMemo(() => {
    const term = search.trim().toLocaleLowerCase('tr');
    return allRows.filter((row) => {
      if (tab === 'missing' && row.costStatus !== 'missing') return false;
      if (term !== '' && !row.productName.toLocaleLowerCase('tr').includes(term)) return false;
      return true;
    });
  }, [allRows, tab, search]);

  const hasActiveFilters = tab !== 'all' || search.trim() !== '';

  const clearFilters = React.useCallback(() => {
    setTab('all');
    setSearch('');
  }, []);

  const columns = React.useMemo<ColumnDef<TodayProductRow>[]>(
    () => [
      {
        id: 'rank',
        header: () => t('columns.rank'),
        enableSorting: false,
        enableHiding: false,
        cell: ({ row, table }) => {
          // O(n) findIndex per row (O(n²)/table render) — acceptable only because today's
          // distinct-product set is bounded; do not copy into an unbounded table.
          const position = table.getSortedRowModel().rows.findIndex((r) => r.id === row.id) + 1;
          const Medal = medalForRank(position);
          if (Medal === null) {
            return <span className="text-muted-foreground tabular-nums">{position}</span>;
          }
          return (
            <span className="inline-flex items-center justify-center">
              <Medal aria-hidden className="size-icon-lg text-foreground" />
              <span className="sr-only">{t('rankLabel', { rank: position })}</span>
            </span>
          );
        },
      },
      {
        accessorKey: 'productName',
        header: () => t('columns.product'),
        meta: { label: t('columns.product') },
        cell: ({ row }) => {
          const product = row.original;
          return (
            <div className="gap-sm flex items-center">
              <ImageCell src={product.thumbUrl} alt={product.productName} size="md" />
              <div className="gap-3xs flex min-w-0 flex-col">
                <span className="text-foreground line-clamp-1 text-sm font-medium">
                  {product.productName}
                </span>
                <div className="gap-sm flex items-center">
                  <CopyableValue value={product.stockCode} label={t('stockCodeLabel')}>
                    <span className="text-muted-foreground font-mono text-xs">
                      {product.stockCode}
                    </span>
                  </CopyableValue>
                  <CopyableValue value={product.barcode} label={t('barcodeLabel')}>
                    <span className="text-muted-foreground font-mono text-xs">
                      {product.barcode}
                    </span>
                  </CopyableValue>
                </div>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'orderCount',
        header: () => t('columns.orderCount'),
        meta: { numeric: true, label: t('columns.orderCount') },
        cell: ({ row }) => <span className="tabular-nums">{row.original.orderCount}</span>,
      },
      {
        accessorKey: 'unitsSold',
        header: () => t('columns.unitsSold'),
        meta: { numeric: true, label: t('columns.unitsSold') },
        cell: ({ row }) => (
          <span className="text-foreground font-medium tabular-nums">{row.original.unitsSold}</span>
        ),
      },
      {
        id: 'revenue',
        // Sort-only float coercion of the Decimal string; the displayed value stays the
        // exact Decimal string via <Currency> below. Float rounding only affects ordering.
        accessorFn: (row) => Number(row.revenue),
        header: () => t('columns.revenue'),
        meta: { numeric: true, label: t('columns.revenue') },
        cell: ({ row }) => <Currency value={row.original.revenue} />,
      },
      {
        id: 'cost',
        header: () => t('columns.cost'),
        enableSorting: false,
        meta: { label: t('columns.cost') },
        cell: ({ row }) => {
          const product = row.original;
          if (product.costStatus === 'costed') {
            return product.unitCost !== null ? (
              <Currency value={product.unitCost} className="text-muted-foreground" />
            ) : (
              <span className="text-muted-foreground">—</span>
            );
          }
          return (
            <CostCellPopover orgId={orgId} variantId={product.variantId}>
              <Button type="button" size="sm" variant="outline" className="gap-2xs shrink-0">
                <Alert02Icon className="size-icon-sm text-warning" />
                {t('addCostButton')}
              </Button>
            </CostCellPopover>
          );
        },
      },
    ],
    [t, orgId],
  );

  const toolbar = React.useCallback(
    (table: TanstackTable<TodayProductRow>) => (
      <DataTableToolbar
        table={table}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('searchPlaceholder')}
      />
    ),
    [search, t],
  );

  const tabs = (
    <FilterTabs<ProductsTab>
      value={tab}
      onValueChange={setTab}
      loading={query.isPending}
      options={[
        { value: 'all', label: t('tabs.all'), count: allRows.length },
        { value: 'missing', label: t('tabs.missing'), count: missingCount },
      ]}
    />
  );

  return (
    <section className="gap-sm flex flex-col">
      <h2 className="text-foreground text-lg font-semibold">{t('title')}</h2>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.variantId}
        initialSorting={[{ id: 'unitsSold', desc: true }]}
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => void query.refetch()}
        tabs={tabs}
        toolbar={toolbar}
        pagination={(table) => <DataTablePagination table={table} />}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        empty={<EmptyState title={t('emptyTitle')} embedded />}
        noResultsState={
          <EmptyState
            title={t('noResultsTitle')}
            description={t('noResultsDescription')}
            embedded
            action={
              <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                {t('clearFilters')}
              </Button>
            }
          />
        }
      />
    </section>
  );
}
