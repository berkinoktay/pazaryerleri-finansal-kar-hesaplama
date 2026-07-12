'use client';

import {
  type ColumnDef,
  type Row,
  type SortingState,
  type Table as TanstackTable,
} from '@tanstack/react-table';
import { ArrowRight01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import type { FilterFieldDef, FilterRow } from '@/lib/advanced-filter';
import { CopyableValue } from '@/components/patterns/copyable-value';
import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

import type { ProductFacetsResponse } from '../api/list-product-facets.api';
import type { ProductWithVariants } from '../api/list-products.api';
import {
  computeDeliveryType,
  desiRange,
  dominantDeliveryType,
  isMultiVariant,
  priceRange,
  totalStock,
} from '../lib/format-product';
import {
  type ProductListSortExtended,
  type ProductOverrideMissing,
} from '../lib/products-filter-parsers';

import { ColorAttribute } from './color-attribute';
import { CostCell } from './cost-cell';
import { CostCellPopover } from '@/features/costs/components/cost-cell-popover';
import { DeliveryBadge } from './delivery-badge';
import { DesiCell } from './desi-cell';
import { DesiCellPopover } from './desi-cell-popover';
import { ParentRowCostCell } from './parent-row-cost-cell';
import { ProductImageCell } from '@/components/patterns/product-image-cell';
import { ProductsBulkCostActionBar } from './products-bulk-cost-action-bar';
import type { ProductRow } from './products-bulk-cost-action-bar.types';
import { ProductsTabStrip, type ProductsOverrideTab } from './products-tab-strip';
import { VariantDelistedBadge } from './variant-delisted-badge';

function projectRows(products: ProductWithVariants[]): ProductRow[] {
  return products.map((p) => ({ kind: 'parent', product: p }));
}

/**
 * Extracts selected ProductRow originals from the TanStack table instance.
 * Used to feed the bulk action bar.
 */
function getSelectedRowOriginals(table: TanstackTable<ProductRow>): ProductRow[] {
  return table.getSelectedRowModel().rows.map((r) => r.original);
}

/**
 * Whether a variant sub-row is the LAST of its parent's variants — drives the
 * `└` terminator on the tree connector (the last elbow has no through-line
 * below it, so it must not render the continuous spine).
 */
function isLastVariant(row: Row<ProductRow>): boolean {
  const parent = row.getParentRow();
  if (parent === undefined) return false;
  const subs = parent.subRows;
  return subs.length > 0 && subs[subs.length - 1]?.id === row.id;
}

interface ProductsTableProps {
  orgId: string;
  storeId: string;
  data: ProductWithVariants[];
  loading?: boolean;
  empty?: React.ReactNode;
  pagination?: { page: number; perPage: number; total: number; totalPages: number };

  // URL-driven filter state — passed in so the toolbar's controlled-search
  // input stays in sync with the URL.
  q: string;
  overrideMissing: ProductOverrideMissing | null;
  sort: ProductListSortExtended;

  // Override-state tab strip props — the strip lives INSIDE the DataTable
  // shell now (top zone, above the toolbar), so the table owns rendering
  // and forwards the change callback up to the page client which mutates URL state.
  overrideTab: ProductsOverrideTab;
  overrideCounts?: ProductFacetsResponse['overrideCounts'];
  facetsLoading?: boolean;
  onOverrideTabChange: (next: ProductsOverrideTab) => void;

  // Advanced Filtering — the per-table catalog, the committed FilterRow[],
  // and the Apply commit handler. The toolbar's `advancedFilter` config is
  // the SINGLE filter system (status/brand/category included); the old quick
  // facet chips were retired.
  filterFields: FilterFieldDef[];
  filterRows: FilterRow[];
  onFiltersApply: (rows: FilterRow[]) => void;

  onSearchChange: (next: string) => void;
  onSortChange: (next: ProductListSortExtended) => void;
  onPageChange: (next: number) => void;
  onPerPageChange: (next: number) => void;
  /** Muted freshness trace rendered in the pagination footer's left cluster. */
  paginationLeading?: React.ReactNode;
}

/**
 * Products table built on the shared DataTable pattern with TanStack v8's
 * native getSubRows machinery — multi-variant parents render their child
 * variants as sibling rows in the same grid (column widths align). The
 * variant-vs-parent hierarchy is signalled WITHOUT a row background
 * fill — we tried both `--muted` and `--surface-subtle` and the seller
 * read both as a foreign surface that broke the table's airy feel. Instead a
 * dedicated "Varyantlar" column (LEFT of "Ürün") carries the expand affordance:
 * the variant-count chip (rotating caret) on multi-variant parents, and a
 * file-tree connector — a continuous `--tree-line` spine with ├/└ elbows — on
 * the variant sub-rows, each elbow reaching the column's right edge to point at
 * the product image next door. The connector is drawn on the "Varyantlar" `<td>`
 * from the `.variant-ident` / `.parent-ident-open` marker classes (see
 * tokens/components.css). NO side-stripe — banned by /ui-design-system BAN 1.
 *
 * Column layout: select · Varyantlar (expand chip + tree) · Ürün bilgisi
 * (image + identifiers) · Beden · Renk · Satış fiyatı · Stok · Teslimat · Desi
 * · Maliyet. Retired earlier: the "Barkod" and "Durum" columns (every
 * alphanumeric identifier — model / stock / barcode — now ships inside the
 * title cell with an explicit `Marka · Kategori` label line plus dedicated
 * `Stok Kodu` / `Barkod` / `Model Kodu` lines, each wrapped in `CopyableValue`;
 * status is covered by the override tab strip + status filter).
 *
 * Variant sub-rows mirror their parent's image at the same 56px size (no
 * step-down) and surface both `Stok Kodu` and `Barkod` on two labelled, copyable
 * rows. Rows are `align-middle` and the identity image is `items-center`, so the
 * chip / tree in the "Varyantlar" column line up with the product image.
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
        // Row selection checkbox — parent rows only. Variant sub-rows don't
        // need independent selection; selecting the parent is the intent.
        id: 'select',
        enableSorting: false,
        meta: { skeleton: 'checkbox' },
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() ? 'indeterminate' : false)
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={t('a11y.selectAll')}
            className="block"
          />
        ),
        cell: ({ row }) => {
          // Variant sub-rows don't render a checkbox — they're subsumed
          // by the parent row's selection.
          if (row.depth > 0) return null;
          return (
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label={t('a11y.selectRow')}
              onClick={(e) => e.stopPropagation()}
              className="block"
            />
          );
        },
      },
      {
        // Dedicated "Varyantlar" column, LEFT of the identity ("Ürün") column,
        // to expand/collapse a product's variants — pulled OUT of the identity
        // cell so the product info is no longer squeezed. Holds the variant-count
        // chip (multi-variant parents) and the file-tree connector on the variant
        // sub-rows: a continuous `--tree-line` spine with ├/└ elbows, drawn on
        // this <td> in tokens/components.css via the `.variant-ident` /
        // `.parent-ident-open` marker classes; the elbow reaches the column's
        // right edge, pointing at the product image in the adjacent cell.
        // Everything aligns on the row's vertical centre (align-middle), matching
        // the centred product image.
        id: 'variants',
        header: () => tCols('variants'),
        enableSorting: false,
        enableHiding: false,
        meta: { skeleton: 'none' },
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            // Variant sub-row: just the tree connector. `.variant-ident` makes
            // the <td> position:relative so the spine spans its padding box and
            // meets the next sibling across the row border (one continuous line).
            return (
              <div className={cn('variant-ident', isLastVariant(row) && 'variant-ident-last')}>
                <span aria-hidden className="variant-ident-spine" />
                <span aria-hidden className="variant-ident-elbow" />
              </div>
            );
          }
          const p = row.original.product;
          if (!isMultiVariant(p)) return null;
          const expanded = row.getIsExpanded();
          return (
            <div className={cn('flex justify-center', expanded && 'parent-ident-open')}>
              {expanded ? <span aria-hidden className="parent-ident-stub" /> : null}
              <button
                type="button"
                onClick={row.getToggleExpandedHandler()}
                aria-label={expanded ? t('a11y.collapseRow') : t('a11y.expandRow')}
                aria-expanded={expanded}
                className={cn(
                  // `relative` so the opaque chip paints ABOVE the absolutely-
                  // positioned tree stub (both are positioned descendants of the
                  // relative <td>; later-in-DOM wins) — the spine emerges from
                  // BENEATH the chip instead of drawing a line across it.
                  'gap-3xs px-xs py-3xs text-2xs [&_svg]:size-icon-xs relative inline-flex cursor-pointer items-center rounded-md border font-medium tabular-nums',
                  'duration-fast transition-colors',
                  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                  expanded
                    ? 'bg-primary-soft text-primary-soft-foreground border-transparent'
                    : 'border-border bg-card text-foreground hover:bg-muted hover:border-border-strong',
                )}
              >
                {p.variantCount}
                <ArrowRight01Icon
                  className={cn(
                    'duration-base transition-transform',
                    expanded && 'text-primary rotate-90',
                  )}
                />
              </button>
            </div>
          );
        },
      },
      {
        // id matches the backend `title` sort key so sortToTanstack /
        // tanstackToSort round-trip cleanly when the user toggles the "Ürün"
        // header. accessorFn is a no-op contract requirement — it unlocks the
        // sort header button under `manualSorting` (server-driven ordering; the
        // returned value is never used client-side). The expand chip + variant
        // tree live in the dedicated "Varyantlar" column to the LEFT, so this
        // identity cell is purely the product image + stacked identifier lines.
        // `items-center` centres the image on the row so it aligns with the chip
        // / tree in the neighbouring column.
        id: 'title',
        accessorFn: (row) => (row.kind === 'parent' ? row.product.title : ''),
        header: () => tCols('title'),
        // Loaded cell is a 56px image + stacked identifier lines — preview the
        // same footprint so rows don't grow when data lands.
        meta: { skeleton: 'identity' },
        enableSorting: true,
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            const v = row.original.variant;
            const parent = row.original.parent;
            const parentImage = parent.images[0];
            return (
              <div className="gap-sm flex items-center">
                <ProductImageCell
                  url={parentImage?.url ?? null}
                  alt={parent.title}
                  size="lg"
                  fit="cover"
                />
                <div className="gap-3xs flex min-w-0 flex-col">
                  <LabeledIdentifier label={tCols('stockCode')} value={v.stockCode} />
                  <LabeledIdentifier label={tCols('barcode')} value={v.barcode} />
                </div>
              </div>
            );
          }
          // Parent row. Two identity layouts by variant multiplicity: multi-variant
          // surfaces the model code (the shared grouping key); single-variant
          // surfaces the variant's own identifiers (the variant IS the product).
          const p = row.original.product;
          const firstImage = p.images[0];
          const v0 = !isMultiVariant(p) ? p.variants[0] : null;
          return (
            <div className="gap-sm flex items-center">
              <ProductImageCell url={firstImage?.url ?? null} alt={p.title} size="lg" fit="cover" />
              <div className="gap-3xs flex min-w-0 flex-col">
                <span className="text-foreground line-clamp-1 font-medium">{p.title}</span>
                <BrandCategoryLine
                  brand={p.brand.name}
                  category={p.category.name}
                  brandLabel={tCols('brand')}
                  categoryLabel={tCols('category')}
                />
                {v0 !== null ? (
                  <>
                    <LabeledIdentifier label={tCols('stockCode')} value={v0.stockCode} />
                    <LabeledIdentifier label={tCols('barcode')} value={v0.barcode} />
                  </>
                ) : (
                  <LabeledIdentifier label={tCols('productMainId')} value={p.productMainId} />
                )}
              </div>
            </div>
          );
        },
      },
      {
        // Beden — variant-level attribute (Trendyol's "varianter").
        // Parent rows aggregate sizes across variants; sub-rows show the
        // single variant's own size as one chip.
        id: 'size',
        header: () => tCols('size'),
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            const v = row.original.variant;
            return v.size !== null && v.size.length > 0 ? (
              <span className="text-foreground text-sm">{v.size}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            );
          }
          const p = row.original.product;
          if (!isMultiVariant(p)) {
            const size = p.variants[0]?.size;
            return size !== undefined && size !== null && size.length > 0 ? (
              <span className="text-foreground text-sm">{size}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            );
          }
          // Multi-variant parent: aggregate label ("N varyant") instead of
          // mapping every variant's size as a chip. With long Trendyol
          // size strings (e.g. `100 × 200 × 10 cm Cam Renk`) the chip
          // stack wrapped into a tall, busy block — sellers asked for
          // the same calm "N Varyant" summary that Trendyol's own panel
          // uses, with the actual sizes available one click away in the
          // expanded variant sub-rows.
          return (
            <span className="text-muted-foreground text-xs">
              {t('multiVariantPlaceholder', { n: p.variantCount })}
            </span>
          );
        },
      },
      {
        // Renk — content-level attribute (Trendyol's "slicer", typically).
        // Lives on Product, not ProductVariant: every variant of one
        // content shares the same color. Variant sub-rows therefore
        // leave Renk empty to avoid redundancy with the parent row.
        id: 'color',
        header: () => tCols('color'),
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            return <span aria-hidden />;
          }
          const color = row.original.product.color;
          if (color === null || color.length === 0) {
            return <span className="text-muted-foreground">—</span>;
          }
          return <ColorAttribute color={color} />;
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
          // Variant rows can additionally carry a "delisted" chip when the
          // full catalog scan's absence pass has stamped delistedAt (the
          // variant was missing from a complete catalog sweep); the hourly
          // delta only clears it again when the variant reappears. Parent
          // rows only show the aggregate count.
          if (row.original.kind === 'variant') {
            const v = row.original.variant;
            return (
              <div className="gap-3xs flex flex-col items-end">
                <StockCount count={v.quantity} />
                {v.delistedAt !== null ? <VariantDelistedBadge /> : null}
              </div>
            );
          }
          return <StockCount count={totalStock(row.original.product.variants)} />;
        },
      },
      {
        id: 'delivery',
        header: () => tCols('delivery'),
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            return <DeliveryBadge type={computeDeliveryType(row.original.variant)} />;
          }
          const { type, mixed } = dominantDeliveryType(row.original.product.variants);
          return <DeliveryBadge type={type} mixed={mixed} />;
        },
      },
      {
        id: 'desi',
        header: () => tCols('desi'),
        meta: { numeric: true },
        cell: ({ row }) => {
          if (row.original.kind === 'parent') {
            const p = row.original.product;
            if (!isMultiVariant(p)) {
              const v = p.variants[0];
              if (v === undefined) return <span className="text-muted-foreground">—</span>;
              return (
                <DesiCellPopover orgId={props.orgId} storeId={props.storeId} variant={v}>
                  <span>
                    <DesiCell variant={v} />
                  </span>
                </DesiCellPopover>
              );
            }
            const range = desiRange(p.variants);
            if (range === null) return <span className="text-muted-foreground">—</span>;
            if (range.isSingle) {
              return (
                <span
                  className={cn(
                    'text-sm tabular-nums',
                    range.anyOverridden ? 'text-primary font-medium' : 'text-foreground',
                  )}
                >
                  {range.min}
                </span>
              );
            }
            return (
              <span className="text-foreground text-sm tabular-nums">
                {range.min} – {range.max}
              </span>
            );
          }
          const v = row.original.variant;
          return (
            <DesiCellPopover orgId={props.orgId} storeId={props.storeId} variant={v}>
              <span>
                <DesiCell variant={v} />
              </span>
            </DesiCellPopover>
          );
        },
      },
      {
        id: 'cost',
        header: () => tCols('cost'),
        meta: { numeric: true },
        cell: ({ row }) => {
          if (row.original.kind === 'parent') {
            const p = row.original.product;
            if (!isMultiVariant(p)) {
              // Single-variant product: show the variant cost cell inline.
              const v = p.variants[0];
              if (v === undefined) return <span className="text-muted-foreground">—</span>;
              return (
                <CostCellPopover orgId={props.orgId} storeId={props.storeId} variantId={v.id}>
                  <span>
                    <CostCell variant={v} />
                  </span>
                </CostCellPopover>
              );
            }
            // Multi-variant parent: aggregate cell (PR 10).
            return <ParentRowCostCell orgId={props.orgId} storeId={props.storeId} product={p} />;
          }
          // Variant sub-row: interactive cost cell.
          const v = row.original.variant;
          return (
            <CostCellPopover orgId={props.orgId} storeId={props.storeId} variantId={v.id}>
              <span>
                <CostCell variant={v} />
              </span>
            </CostCellPopover>
          );
        },
      },
    ],
    [formatter, t, tCols, props.orgId],
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
      enableRowSelection
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
          advancedFilter={{
            fields: props.filterFields,
            value: props.filterRows,
            onApply: props.onFiltersApply,
          }}
        />
      )}
      pagination={(table) => (
        <DataTablePagination table={table} leading={props.paginationLeading} />
      )}
      // Always mounted (not gated on selection) so BulkActionBar's own presence
      // machine can play the exit animation when the selection clears — gating
      // here would unmount it mid-transition. The bar self-hides below its
      // minSelected (2 for bulk cost ops, set inside ProductsBulkCostActionBar).
      fab={(table) => (
        <ProductsBulkCostActionBar
          orgId={props.orgId}
          storeId={props.storeId}
          selectedRows={getSelectedRowOriginals(table)}
          onClearSelection={() => table.resetRowSelection()}
        />
      )}
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
  if (head === undefined) return '-platformCreatedAt';
  return (head.desc ? `-${head.id}` : head.id) as ProductListSortExtended;
}

// ─── Cell sub-components ──────────────────────────────────────────
// Two tiny presentational helpers shared across the parent + variant
// title cell renderers above. They live in this file (not in a shared
// pattern) because the visual contract — small muted label + mono
// value + optional copy — is specific to "products table identifier
// rows" and changes whenever this table's typography does.

interface StockCountProps {
  count: number;
}

/**
 * Stock cell renderer with three semantic tiers — surfaces inventory
 * health at a glance without an extra column or icon:
 *
 *   - 0     → `text-destructive` — out of stock, the seller has lost
 *             the listing and needs to act now.
 *   - 1–9   → `text-warning` — low stock, an early signal to reorder
 *             before the variant goes out.
 *   - 10+   → `text-foreground` — healthy, no styling needed (color
 *             tokens reserved for things that need attention).
 *
 * Using semantic color tokens (not raw hex / OKLCH) means dark-mode
 * gets the same treatment automatically without a parallel ladder.
 */
function StockCount({ count }: StockCountProps): React.ReactElement {
  return (
    <span
      className={cn(
        'font-medium tabular-nums',
        count === 0 && 'text-destructive',
        count > 0 && count < 10 && 'text-warning',
      )}
    >
      {count}
    </span>
  );
}

interface LabeledIdentifierProps {
  label: string;
  value: string | null | undefined;
}

/**
 * One row of "label  {monospace value} [copy on hover]". The full
 * value is the click target via CopyableValue; the label is decorative
 * and stays muted. Used for stockCode, barcode, productMainId.
 *
 * Returns null when the value is missing — empty string, null, or
 * undefined — so the parent cell doesn't render an orphan label
 * (e.g. "Stok Kodu" with nothing after it). The whole pair drops out
 * together; the layout collapses naturally because callers compose
 * these via flex-col gap, not fixed rows.
 */
function LabeledIdentifier({ label, value }: LabeledIdentifierProps): React.ReactElement | null {
  if (value === null || value === undefined || value.length === 0) {
    return null;
  }
  return (
    <span className="gap-xs flex items-baseline text-xs">
      <span className="text-muted-foreground">{label}</span>
      <CopyableValue value={value} label={label}>
        <span className="text-foreground font-mono">{value}</span>
      </CopyableValue>
    </span>
  );
}

interface BrandCategoryLineProps {
  brand: string | null;
  category: string | null;
  brandLabel: string;
  categoryLabel: string;
}

/**
 * Brand + category line on parent rows, both labelled. Rendered as
 * two label-value pairs with breathing room between them — without
 * labels the seller couldn't tell "Guess · Spor" was brand · category.
 */
function BrandCategoryLine({
  brand,
  category,
  brandLabel,
  categoryLabel,
}: BrandCategoryLineProps): React.ReactElement | null {
  const hasBrand = brand !== null && brand.length > 0;
  const hasCategory = category !== null && category.length > 0;
  if (!hasBrand && !hasCategory) return null;
  return (
    <span className="gap-md flex flex-wrap items-baseline text-xs">
      {hasBrand ? (
        <span className="gap-xs flex items-baseline">
          <span className="text-muted-foreground">{brandLabel}</span>
          <span className="text-foreground">{brand}</span>
        </span>
      ) : null}
      {hasCategory ? (
        <span className="gap-xs flex items-baseline">
          <span className="text-muted-foreground">{categoryLabel}</span>
          <span className="text-foreground">{category}</span>
        </span>
      ) : null}
    </span>
  );
}
