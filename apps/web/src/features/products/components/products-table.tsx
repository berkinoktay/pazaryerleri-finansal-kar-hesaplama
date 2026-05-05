'use client';

import { type ColumnDef, type SortingState } from '@tanstack/react-table';
import { ArrowDown01Icon, ArrowRight01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';

import type { ProductFacetsResponse } from '../api/list-product-facets.api';
import type { ProductWithVariants, VariantSummary } from '../api/list-products.api';
import {
  dominantDeliveryDuration,
  isMultiVariant,
  priceRange,
  summarizeStatus,
  totalStock,
  uniqueSizes,
} from '../lib/format-product';
import {
  type ProductListSortExtended,
  type ProductOverrideMissing,
  type ProductVariantStatus,
} from '../lib/products-filter-parsers';

import { DeliveryBadge } from './delivery-badge';
import { ProductImageCell } from './product-image-cell';
import { ProductsFacetChips } from './products-facet-chips';
import { ProductsTabStrip, type ProductsOverrideTab } from './products-tab-strip';
import { VariantStatusBadge } from './variant-status-badge';

/**
 * Discriminated union projected from the API's ProductWithVariants.
 * Parent rows render the compound product cell + aggregate cells;
 * variant rows (depth=1, returned by getSubRows) render per-SKU detail.
 *
 * The same `columns[]` defines BOTH visual treatments — column cell
 * renderers branch on `row.original.kind`. Column widths align by
 * construction because TanStack v8 reuses the parent column defs for
 * sub-rows when `getSubRows` is supplied.
 */
type ProductRow =
  | { kind: 'parent'; product: ProductWithVariants }
  | { kind: 'variant'; parent: ProductWithVariants; variant: VariantSummary };

function projectRows(products: ProductWithVariants[]): ProductRow[] {
  return products.map((p) => ({ kind: 'parent', product: p }));
}

interface ProductsTableProps {
  data: ProductWithVariants[];
  loading?: boolean;
  empty?: React.ReactNode;
  pagination?: { page: number; perPage: number; total: number; totalPages: number };

  // URL-driven filter state — passed in so the toolbar's controlled-search
  // input + the facet chips stay in sync with the URL.
  q: string;
  status: ProductVariantStatus;
  brandId: string;
  categoryId: string;
  overrideMissing: ProductOverrideMissing | null;
  sort: ProductListSortExtended;

  facets?: ProductFacetsResponse;

  // Override-state tab strip props — the strip lives INSIDE the DataTable
  // shell now (top zone, above the toolbar), so the table owns rendering
  // and forwards the change callback up to the page client which mutates URL state.
  overrideTab: ProductsOverrideTab;
  overrideCounts?: ProductFacetsResponse['overrideCounts'];
  facetsLoading?: boolean;
  onOverrideTabChange: (next: ProductsOverrideTab) => void;

  onSearchChange: (next: string) => void;
  onStatusChange: (next: ProductVariantStatus) => void;
  onBrandChange: (next: string) => void;
  onCategoryChange: (next: string) => void;
  onSortChange: (next: ProductListSortExtended) => void;
  onPageChange: (next: number) => void;
  onPerPageChange: (next: number) => void;
}

/**
 * Products table built on the shared DataTable pattern with TanStack v8's
 * native getSubRows machinery — multi-variant parents render their child
 * variants as sibling rows in the same grid (column widths align), with
 * a tree connector + muted background tint applied by `data-depth='1'`
 * on the row element (token-driven, see tokens/components.css).
 *
 * 8-column hierarchical layout: expand · Ürün bilgisi (compound: image +
 * title + brand·category·model code subtitle) · Özellikler · Barkod ·
 * Satış fiyatı · Stok · Teslimat · Durum.
 *
 * Server-side everything: sorting, filtering, pagination — DataTable runs
 * in controlled mode for sort + pagination, and the toolbar's controlled-
 * search mode emits q changes back through `onSearchChange`. The data
 * passed in is already the current page's slice.
 */
export function ProductsTable(props: ProductsTableProps): React.ReactElement {
  const t = useTranslations('products');
  const tCols = useTranslations('products.columns');
  const formatter = useFormatter();

  const rows = React.useMemo(() => projectRows(props.data), [props.data]);

  const columns = React.useMemo<ColumnDef<ProductRow>[]>(
    () => [
      {
        id: 'expand',
        enableSorting: false,
        cell: ({ row }) => {
          if (row.depth > 0) {
            return (
              <span aria-hidden className="text-muted-foreground">
                └
              </span>
            );
          }
          if (!row.getCanExpand()) {
            return <span aria-hidden className="size-icon-sm inline-block" />;
          }
          const expanded = row.getIsExpanded();
          return (
            <button
              type="button"
              onClick={row.getToggleExpandedHandler()}
              aria-label={expanded ? t('a11y.collapseRow') : t('a11y.expandRow')}
              aria-expanded={expanded}
              className="text-muted-foreground hover:text-foreground p-3xs duration-fast hover:bg-background focus-visible:ring-ring inline-flex items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {expanded ? (
                <ArrowDown01Icon className="size-icon-sm" />
              ) : (
                <ArrowRight01Icon className="size-icon-sm" />
              )}
            </button>
          );
        },
      },
      {
        // id matches the backend `title` sort key so sortToTanstack /
        // tanstackToSort round-trip cleanly when the user toggles the
        // "Ürün" header. Column label still reads "Ürün" via tCols('title').
        // accessorFn is a no-op contract requirement — TanStack v8's
        // `column.getCanSort()` returns false unless the column declares
        // an accessor (key or fn), even when `enableSorting: true`. Since
        // ordering is server-driven (`manualSorting: true`), the returned
        // value is never used for client-side sorting; it just unlocks the
        // sort header button.
        id: 'title',
        accessorFn: (row) => (row.kind === 'parent' ? row.product.title : ''),
        header: () => tCols('title'),
        enableSorting: true,
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            const v = row.original.variant;
            const sizePrefix = v.size !== null && v.size.length > 0 ? `${v.size} · ` : '';
            return (
              <span className="text-muted-foreground font-mono text-xs">
                {sizePrefix}
                {v.stockCode}
              </span>
            );
          }
          const p = row.original.product;
          const firstImage = p.images[0];
          const subtitle = [p.brand.name, p.category.name, p.productMainId]
            .filter((s): s is string => s !== null && s.length > 0)
            .join(' · ');
          return (
            <div className="gap-sm flex items-center">
              <ProductImageCell url={firstImage?.url ?? null} alt={p.title} />
              <div className="gap-3xs flex flex-col">
                <span className="text-foreground line-clamp-1 font-medium">{p.title}</span>
                <span className="text-muted-foreground line-clamp-1 text-xs">{subtitle}</span>
              </div>
            </div>
          );
        },
      },
      {
        id: 'properties',
        header: () => tCols('properties'),
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            const v = row.original.variant;
            const parts = [v.size, row.original.parent.color].filter(
              (s): s is string => s !== null && s !== undefined && s.length > 0,
            );
            return parts.length > 0 ? parts.join(' · ') : '—';
          }
          const p = row.original.product;
          if (!isMultiVariant(p)) {
            const v0 = p.variants[0];
            const parts = [v0?.size, p.color].filter(
              (s): s is string => s !== null && s !== undefined && s.length > 0,
            );
            return parts.length > 0 ? parts.join(' · ') : '—';
          }
          const { shown, remaining } = uniqueSizes(p.variants);
          if (shown.length > 0) {
            return `${shown.join(', ')}${remaining > 0 ? ` +${remaining.toString()}` : ''}`;
          }
          return t('multiVariantPlaceholder', { n: p.variantCount });
        },
      },
      {
        id: 'barcode',
        header: () => tCols('barcode'),
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            return <span className="font-mono text-xs">{row.original.variant.barcode}</span>;
          }
          const p = row.original.product;
          if (isMultiVariant(p)) {
            return (
              <span className="text-muted-foreground text-xs">
                {t('multiVariantPlaceholder', { n: p.variantCount })}
              </span>
            );
          }
          return <span className="font-mono text-xs">{p.variants[0]?.barcode ?? '—'}</span>;
        },
      },
      {
        id: 'salePrice',
        // accessorFn unlocks canSort (see `title` column for the rationale).
        // Returns the first variant's sale price as a number — never read
        // because manualSorting is on, so any value works.
        accessorFn: (row) =>
          row.kind === 'parent'
            ? Number(row.product.variants[0]?.salePrice ?? 0)
            : Number(row.variant.salePrice),
        header: () => tCols('salePrice'),
        meta: { numeric: true },
        enableSorting: true,
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            return <Currency value={row.original.variant.salePrice} />;
          }
          const range = priceRange(row.original.product.variants);
          if (range === null) return '—';
          if (range.isSingle) {
            return <Currency value={range.min} />;
          }
          return (
            <span className="tabular-nums">
              {formatter.number(Number.parseFloat(range.min), 'currency')}
              {' – '}
              {formatter.number(Number.parseFloat(range.max), 'currency')}
            </span>
          );
        },
      },
      {
        id: 'totalStock',
        // accessorFn unlocks canSort (see `title` column for the rationale).
        accessorFn: (row) =>
          row.kind === 'parent' ? totalStock(row.product.variants) : row.variant.quantity,
        header: () => tCols('stock'),
        meta: { numeric: true },
        enableSorting: true,
        cell: ({ row }) => {
          const v =
            row.original.kind === 'variant'
              ? row.original.variant.quantity
              : totalStock(row.original.product.variants);
          return <span className="tabular-nums">{v}</span>;
        },
      },
      {
        id: 'delivery',
        header: () => tCols('delivery'),
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            const v = row.original.variant;
            return <DeliveryBadge durationDays={v.deliveryDuration} isRush={v.isRushDelivery} />;
          }
          const { value, mixed } = dominantDeliveryDuration(row.original.product.variants);
          const v0 = row.original.product.variants[0];
          return (
            <DeliveryBadge
              durationDays={value}
              isRush={v0?.isRushDelivery ?? false}
              mixed={mixed}
            />
          );
        },
      },
      {
        id: 'status',
        header: () => tCols('status'),
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            return <VariantStatusBadge status={row.original.variant.status} />;
          }
          const summary = summarizeStatus(row.original.product.variants);
          if (summary === null) return '—';
          const others = Object.entries(summary.counts)
            .filter(([k]) => k !== summary.dominant)
            .reduce((s, [, n]) => s + (n ?? 0), 0);
          return <VariantStatusBadge status={summary.dominant} overflowCount={others} />;
        },
      },
    ],
    [formatter, t, tCols],
  );

  // Map the URL sort string back into TanStack's SortingState shape, and
  // back the other way when the user clicks a header.
  const sortingState = sortToTanstack(props.sort);

  return (
    <DataTable<ProductRow, unknown>
      columns={columns}
      data={rows}
      loading={props.loading}
      empty={props.empty}
      getRowId={(row) => (row.kind === 'parent' ? `p:${row.product.id}` : `v:${row.variant.id}`)}
      getRowCanExpand={(row) =>
        row.original.kind === 'parent' && isMultiVariant(row.original.product)
      }
      getSubRows={(row) => {
        if (row.kind !== 'parent' || !isMultiVariant(row.product)) return undefined;
        return row.product.variants.map((v) => ({
          kind: 'variant',
          parent: row.product,
          variant: v,
        }));
      }}
      sorting={sortingState}
      onSortingChange={(updater) => {
        const next = typeof updater === 'function' ? updater(sortingState) : updater;
        props.onSortChange(tanstackToSort(next));
      }}
      paginationState={{
        pageIndex: (props.pagination?.page ?? 1) - 1,
        pageSize: props.pagination?.perPage ?? 25,
      }}
      onPaginationChange={(updater) => {
        const current = {
          pageIndex: (props.pagination?.page ?? 1) - 1,
          pageSize: props.pagination?.perPage ?? 25,
        };
        const next = typeof updater === 'function' ? updater(current) : updater;
        if (next.pageSize !== current.pageSize) {
          props.onPerPageChange(next.pageSize);
        } else if (next.pageIndex !== current.pageIndex) {
          props.onPageChange(next.pageIndex + 1);
        }
      }}
      pageCount={props.pagination?.totalPages ?? 0}
      rowCount={props.pagination?.total ?? 0}
      tabs={
        <ProductsTabStrip
          value={props.overrideTab}
          counts={props.overrideCounts}
          loading={props.facetsLoading}
          onChange={props.onOverrideTabChange}
        />
      }
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          searchValue={props.q}
          onSearchChange={props.onSearchChange}
          searchPlaceholder={t('filters.searchPlaceholder')}
          facets={
            <ProductsFacetChips
              brand={props.brandId}
              category={props.categoryId}
              status={props.status}
              brandOptions={(props.facets?.brands ?? []).map((b) => ({
                value: b.id,
                label: b.name,
                count: b.count,
              }))}
              categoryOptions={(props.facets?.categories ?? []).map((c) => ({
                value: c.id,
                label: c.name,
                count: c.count,
              }))}
              onBrandChange={props.onBrandChange}
              onCategoryChange={props.onCategoryChange}
              onStatusChange={props.onStatusChange}
            />
          }
        />
      )}
      pagination={(table) => <DataTablePagination table={table} />}
    />
  );
}

// ─── sort marshalling ───
// URL state stores strings like '-platformModifiedAt'. TanStack's
// SortingState is `[{ id, desc }]`. These two helpers convert between
// the two representations.

function sortToTanstack(sort: ProductListSortExtended): SortingState {
  const desc = sort.startsWith('-');
  const id = desc ? sort.slice(1) : sort;
  return [{ id, desc }];
}

function tanstackToSort(state: SortingState): ProductListSortExtended {
  const head = state[0];
  if (head === undefined) return '-platformModifiedAt';
  return (head.desc ? `-${head.id}` : head.id) as ProductListSortExtended;
}
