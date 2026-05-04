# Products Page Redesign

**Date:** 2026-05-04
**Status:** Draft (brainstorm complete, awaiting spec review)
**Scope:** `apps/web/src/features/products/` — table composition, page-level layout, override-state tabs, toolbar migration. Backend: minor extension to list/facets endpoints. No new schema, no inline editing.

---

## 1. Summary

The Products page currently renders a hand-rolled TanStack table that pre-dates the shared `DataTable` pattern. The variant breakdown for multi-variant products lives in a nested `<Table>` inside a colspan-spanning cell — its columns don't align with the parent grid, so users can't visually scan a variant's price/stock against the parent. The filter bar is a custom composition that doesn't share the canonical `DataTableToolbar` shell used elsewhere in the app.

This redesign:

1. **Migrates the products table to the shared `DataTable`** — eliminates the divergence and gives the page TanStack v8's `subRows` machinery for true grid-aligned variant rows.
2. **Reshapes the column set** to a denser, hierarchical composition: a compound product cell that absorbs brand + category + model code, leaving the rest of the columns for per-variant data (Özellikler · Barkod · Fiyat · Stok · Teslimat · Durum).
3. **Adds an override-state tab strip** above the table (Tümü · Maliyeti girilmemiş · KDV girilmemiş) using the existing `FilterTabs` pattern. Tab counts are server-computed against the full result set.
4. **Migrates the filter bar to the canonical `DataTableToolbar`** with multi-select facet popovers for brand/category/status. This requires a small enhancement to the toolbar: controlled-search mode (search input bound to a page-level `value`/`onChange` pair instead of a TanStack column filter).
5. **Surfaces inherited variant data correctly.** When a multi-variant parent is expanded, each variant row sits in the same grid as the parent above it, with a subtle leading-cell indent + tree connector + tinted background to communicate hierarchy. Brand/category never repeat per variant — they're already in the parent's compound cell.

The redesign is intentionally **structural + display polish only**. It does not introduce inline editing for cost/desi/KDV (Option C scope, deferred). The page continues to render the data the sync pipeline already populates; the Maliyetsiz / KDV'siz tabs simply filter on the existing nullable `costPrice` / `vatRate` columns.

## 2. Goals & Non-Goals

### Goals

- Replace the bespoke `products-table.tsx` + `product-variant-table.tsx` pair with a single `DataTable`-based composition where variant rows live in the parent's grid.
- Compound product cell carrying image + title + `brand · category · model code` subtitle line.
- 8 columns: expand · Ürün bilgisi · Özellikler · Barkod · Satış fiyatı · Stok · Teslimat · Durum.
- Override-state tab strip (Tümü · Maliyetsiz · KDV'siz) above the toolbar, with server-computed counts.
- Migrate to canonical `DataTableToolbar` with multi-select facet popovers (brand · category · status).
- Move SyncBadge from PageHeader's `actions` slot to `meta` (matches the pattern's documented placement).
- Add `salePrice` and `totalStock` to the sortable column vocabulary.
- Variant rows visually identifiable via leading-cell indent + tree connector glyph + `bg-muted` tint.
- Single-variant products render flat — no chevron, no tree, no extra label; the parent row carries the lone variant's data inline.
- Per-tab empty states: "all caught up" copy when a missing-data tab returns 0 rows.

### Non-Goals (explicitly out of scope this PR)

- **No inline editing.** Cost / desi / KDV input cells are not introduced. The `Maliyet`, `Desi`, `Alış KDV %`, `Kar` columns from competitor screenshots are deferred until Option C scope.
- **No `desi` field anywhere** — the column doesn't exist in `ProductVariant` and won't be added in this PR. Therefore no "Desisi girilmemiş" tab.
- **No bulk actions / row selection.** No checkbox column, no `BulkActionBar`. Defer to Option C, where bulk-set-cost is the obvious workflow.
- **No Excel import / export buttons.** Without inline editing there's no round-trip; export-only is a separate request.
- **No new sticky / pinned columns.** 8 columns at typical viewports do not need pinning.
- **No new database schema, no new RLS policies.** All filtering uses existing nullable columns.
- **No realtime wire-shape change.** The existing `OrgSyncsProvider` + product query-key invalidation continue to drive freshness.
- **No marketing / onboarding copy changes.** Page intent and title strings stay as today.

## 3. Decisions Recap

These were locked in during brainstorming via the visual companion. Listed here so reviewers can see the path taken without replaying the session:

| #    | Decision                                   | Resolution                                                                                                                                                        | Why                                                                                                                                                                     |
| ---- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1   | Scope                                      | **B — structural + display polish.** No inline editing in this PR.                                                                                                | Smallest cut that ships visible value (variant alignment, compound cell, status tabs). Decouples the visual redesign from a schema migration + RLS + mutation pipeline. |
| Q2   | Status tabs                                | Use the data we have. Ship the two tabs that map to existing nullable fields (`costPrice`, `vatRate`); skip `desi` until the column exists.                       | Honesty over placeholder UI.                                                                                                                                            |
| Q3   | Table composition                          | **A — Hierarchical, 8 columns, compound product cell.** Variants render as sibling rows in the parent grid with tree connector + tinted bg.                       | Densest legible layout for the dashboard tier the tokens are tuned for. Brand/category never repeat per variant.                                                        |
| Q4   | Page layout                                | **C — Stacked + canonical `DataTableToolbar`.** PageHeader → FilterTabs → DataTableToolbar → DataTable → pagination.                                              | Consistent toolbar with the rest of PazarSync; gains free column-visibility menu; clean hierarchy. Trades dedicated brand/category dropdowns for additive facet chips.  |
| Q5.1 | Single-variant treatment                   | No chevron, no "Tek varyant" label. Parent renders the lone variant's data inline.                                                                                | Multi-variant chevron is the visual signal.                                                                                                                             |
| Q5.2 | "Özellikler" cell on multi-variant parents | `"S, M, L +1 · 4 renk"` — sizes (truncated) + color count.                                                                                                        | Reuses existing `uniqueSizes`; concise; mirrors current aggregator semantics.                                                                                           |
| Q5.3 | Sortable columns                           | `title`, `platformModifiedAt` (default `-platformModifiedAt`), `salePrice`, `totalStock`.                                                                         | Pricing-review and restocking workflows want price/stock sorts.                                                                                                         |
| Q5.4 | Facet popovers                             | Brand · Category · Status migrate to multi-select chip popovers (additive: "+ Filtre ekle").                                                                      | Better discoverability; fewer always-visible empty slots.                                                                                                               |
| Q5.5 | Empty states                               | Per-tab: Tümü → existing variants. Maliyetsiz → "Tüm ürünler için maliyet girilmiş ✓" (positive). KDV'siz → similar. Filter active → existing `filtered` variant. | Tab-aware empty copy turns "nothing" into "you're done."                                                                                                                |
| Q5.6 | Sticky columns                             | None.                                                                                                                                                             | 8 columns fit without horizontal scroll at ≥ 1280px.                                                                                                                    |
| Q5.7 | Realtime / cache                           | Untouched.                                                                                                                                                        | No data-shape change.                                                                                                                                                   |
| Q5.8 | Backend                                    | New `overrideMissing: 'cost' \| 'vat'` query param on the list endpoint. New `overrideCounts: { missingCost, missingVat, total }` on the facets endpoint.         | Tab counts must reflect the full unfiltered result set, not the current page.                                                                                           |
| Q5.9 | Dark mode                                  | Inherits from existing tokens. Variant-row tint = `bg-muted` (already paired with inset-highlight per dark-mode token discipline). No new alpha shortcuts.        | Per `apps/web/CLAUDE.md` — alpha shortcuts are a dark-mode trap.                                                                                                        |

## 4. Architecture

### 4.1 Final layout (vertical stack)

```
┌─────────────────────────────────────────────────────────────┐
│ PageHeader                                                  │
│   title:   "Ürünler"                                        │
│   intent:  "Trendyol mağazandan senkronize edilen onaylı …" │
│   meta:    <SyncBadge … />                ← moved from actions │
│   actions: (none in this PR)                                 │
├─────────────────────────────────────────────────────────────┤
│ FilterTabs (underline variant)                              │
│   [Tümü 118]  [Maliyeti girilmemiş 117]  [KDV girilmemiş 92]│
├─────────────────────────────────────────────────────────────┤
│ DataTableToolbar                                            │
│   [🔍 Search input          ] [+ Marka] [+ Kategori] [+ Durum] │
│                                          [👁 Sütunlar ▾]    │
├─────────────────────────────────────────────────────────────┤
│ DataTable (8 columns, sticky header, controlled mode)       │
│   ▸  Ürün bilgisi      Özellikler  Barkod  Fiyat  Stok …  │
│   ─  Single-variant    Tek ebat    8697…  200₺  29   …    │
│   ▾  Multi-variant     S,M,L+1·4r  ⌬4var  189-249₺ 142 …  │
│   └  Variant 1         S · Beyaz   8697…  189₺   42   …    │
│   ├  Variant 2         M · Siyah   8697…  219₺   36   …    │
│   ├  Variant 3         L · Ekru    8697…  249₺   8    …    │
├─────────────────────────────────────────────────────────────┤
│ DataTablePagination                                         │
│   [10 / sayfa ▾]   « ‹  Sayfa 1 / 6  › »   118 satır       │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Component tree

```
ProductsPage (server component) — apps/web/src/app/[locale]/(dashboard)/products/page.tsx
└── ProductsPageClient — apps/web/src/features/products/components/products-page-client.tsx
    ├── PageHeader (title + intent + meta=<SyncBadge/>)        [pattern]
    ├── ProductsTabStrip                                        [new]
    │   └── FilterTabs                                          [pattern]
    ├── ProductsTable                                           [rewritten]
    │   ├── DataTableToolbar (controlled search mode)          [pattern, EXTENDED]
    │   │   ├── ControlledSearchInput                           [extension]
    │   │   └── facets slot →
    │   │       └── ProductsFacetChips                          [new]
    │   │           ├── FacetChipPopover (Marka)                [new]
    │   │           ├── FacetChipPopover (Kategori)             [new]
    │   │           └── FacetChipPopover (Durum)                [new]
    │   ├── DataTable (controlled sort/filter/pagination,
    │   │             getSubRows + expanded mode)               [pattern]
    │   │   ├── ProductRowCell — compound product cell          [new]
    │   │   ├── PropertiesCell — sizes + color summary          [new]
    │   │   ├── BarcodeCell — single barcode or "N varyant"     [new]
    │   │   ├── PriceRangeCell — single price or range          [new]
    │   │   ├── StockCell — sum or single                       [new]
    │   │   ├── DeliveryBadge                                   [existing]
    │   │   └── VariantStatusBadge                              [existing]
    │   └── DataTablePagination                                 [pattern]
    ├── ProductsEmptyState (variant-aware)                      [extended]
    └── SyncCenter (unchanged)                                  [pattern]
```

Files **deleted**:

- `apps/web/src/features/products/components/products-table.tsx` — replaced.
- `apps/web/src/features/products/components/product-variant-table.tsx` — superseded by sub-row rendering inside the new `ProductsTable`.
- `apps/web/src/features/products/components/products-filter-bar.tsx` — replaced by `DataTableToolbar` + `ProductsFacetChips`.
- `apps/web/src/features/products/components/products-pagination.tsx` — replaced by canonical `DataTablePagination`.
- `apps/web/src/features/products/components/facet-select.tsx` — superseded by `FacetChipPopover`.

Files **kept** (referenced unchanged):

- `apps/web/src/features/products/api/list-products.api.ts` — extended with `overrideMissing` query param.
- `apps/web/src/features/products/api/list-product-facets.api.ts` — extended with `overrideCounts`.
- `apps/web/src/features/products/components/color-attribute.tsx`, `delivery-badge.tsx`, `product-image-cell.tsx`, `variant-status-badge.tsx`.
- `apps/web/src/features/products/lib/format-product.ts` — `priceRange`, `totalStock`, `summarizeStatus`, `uniqueSizes`, `dominantDeliveryDuration` continue to drive aggregate cells.
- `apps/web/src/features/products/lib/products-filter-parsers.ts` — extended with `overrideMissing` parser.

### 4.3 Data flow

```
URL (nuqs)          ───►  useProductsFilters() ───►  useProducts({ overrideMissing, … })
   │                              │                            │
   │                              │                            ▼
   │                              │                       apiClient.GET /v1/.../products
   │                              │                            │
   │                              │                            ▼
   │                              │                       ListProductsResponse
   │                              │                            │
   │                              ▼                            ▼
   │                       Controlled state ───►  DataTable (manualSorting,
   │                       sort / page / perPage / filters     manualFiltering,
   │                                                            manualPagination)
   │                                                              │
   ▼                                                              ▼
DataTable header click  ────────────────────────────────►  onSortingChange
DataTableToolbar search ──►  onSearchChange ──►  setFilters({ q })  ──►  URL updated
FacetChipPopover toggle ──►  onChange       ──►  setFilters({ brandId / categoryId / status })
FilterTabs click        ──►  onValueChange  ──►  setFilters({ overrideMissing, page: 1 })
```

The flow is **unidirectional**: every interaction lands in the URL, and the URL drives the React Query refetch. No optimistic updates needed — server is the source of truth.

## 5. Backend Changes

Three small extensions; no new tables, no new endpoints.

### 5.1 `ListProductsQuerySchema` — add `overrideMissing`

`apps/api/src/validators/product.validator.ts`:

```ts
export const PRODUCT_OVERRIDE_MISSING = ['cost', 'vat'] as const;
export type ProductOverrideMissing = (typeof PRODUCT_OVERRIDE_MISSING)[number];

export const ListProductsQuerySchema = TablePaginationQuerySchema.extend({
  // … existing q, status, brandId, categoryId, sort …
  overrideMissing: z
    .enum(PRODUCT_OVERRIDE_MISSING)
    .optional()
    .openapi({
      description:
        'Variant-level filter: "cost" → variants with NULL costPrice; "vat" → variants with NULL vatRate. ' +
        'Composes with the status filter via AND. Parent included if ≥1 variant matches; ' +
        'response variants[] is filtered to matching variants (consistent with status semantics).',
      example: 'cost',
    }),
  sort: z
    .enum([
      '-platformModifiedAt',
      'platformModifiedAt',
      'title',
      '-title',
      'salePrice', // new
      '-salePrice', // new
      'totalStock', // new — synthetic, see service notes
      '-totalStock', // new
    ])
    .default('-platformModifiedAt'),
});
```

### 5.2 `products-list.service.ts::list` — extend variant-where + sort

```ts
function variantOverrideMissingWhere(
  missing: ProductOverrideMissing,
): Prisma.ProductVariantWhereInput {
  switch (missing) {
    case 'cost':
      return { costPrice: null };
    case 'vat':
      return { vatRate: null };
  }
}

// Compose status + overrideMissing as AND on the same variants.some clause
const variantConditions: Prisma.ProductVariantWhereInput[] = [];
if (filters.status !== undefined) variantConditions.push(variantStatusWhere(filters.status));
if (filters.overrideMissing !== undefined)
  variantConditions.push(variantOverrideMissingWhere(filters.overrideMissing));
const variantWhere = variantConditions.length > 0 ? { AND: variantConditions } : undefined;
```

The `variants: { some: variantWhere }` clause and the response-side `variants: { where: variantWhere }` filtering both pick this up automatically.

For `totalStock` sort: there's no native Prisma sort over an aggregate child. Two options:

- **Option A (chosen):** add a `total_stock` denormalized integer column on `Product` updated by the sync worker each upsert. Indexed. Sort is direct. This is a separate small migration that ships as **PR 0** of the implementation series.
- **Option B (rejected):** sort by `_count.variants.quantity` via a raw query. Loses Prisma type safety, hits write-amplification in a different way, harder to test.

PR 0 is documented separately; the redesign PRs assume the column exists.

### 5.3 `products-list.service.ts::facets` — add `overrideCounts`

```ts
const [brandRows, categoryRows, missingCost, missingVat, total] = await Promise.all([
  /* existing brand groupBy … */,
  /* existing category groupBy … */,
  prisma.product.count({
    where: { organizationId, storeId, variants: { some: { costPrice: null } } },
  }),
  prisma.product.count({
    where: { organizationId, storeId, variants: { some: { vatRate: null } } },
  }),
  prisma.product.count({ where: { organizationId, storeId } }),
]);

return {
  brands: /* … */,
  categories: /* … */,
  overrideCounts: { missingCost, missingVat, total },
};
```

`ProductFacetsResponseSchema` extended with:

```ts
overrideCounts: z.object({
  missingCost: z.number().int().nonnegative(),
  missingVat: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
}).openapi({
  description:
    'Counts of products with ≥1 variant missing the corresponding override field. Used to ' +
    'populate the override-state tab badges. Computed against the unfiltered store-scoped set ' +
    '(does not respect the current q/brand/category/status filters — tabs reset to the full set ' +
    'when activated).',
}),
```

**Tenant isolation:** all three new counts query the same `(organizationId, storeId)` scope as today. No new RLS policy required (existing `is_org_member(organization_id)` covers `Product` and `ProductVariant`).

### 5.4 OpenAPI sync + tests

- After validator edits, run `pnpm api:sync` from repo root → regenerates `packages/api-client/openapi.json` + types.
- New integration tests in `apps/api/tests/integration/routes/products.routes.test.ts`:
  - `overrideMissing=cost` returns only products with ≥1 variant having NULL `costPrice`.
  - `overrideMissing=vat` returns only products with ≥1 variant having NULL `vatRate`.
  - `overrideMissing` + `status=onSale` ANDs correctly (variant must be onSale AND missing cost).
  - `sort=salePrice` orders by max-of-variants ascending.
  - `sort=totalStock` orders by the new `Product.totalStock` column ascending.
- New tenant-isolation test in `apps/api/tests/integration/tenant-isolation/products-override.test.ts`:
  - Org A's missing-cost variant must not surface in Org B's override-counts response.
- Facets test extended for `overrideCounts` shape + values.
- API changelog entry under `[Unreleased]`.

## 6. Frontend Changes

### 6.1 Page composition — `products-page-client.tsx`

The wrapper stays small. Owns URL state + composes children. Pseudo-shape:

```tsx
export function ProductsPageClient({ orgId, storeId, pageTitle, pageIntent }) {
  const { filters, setFilters } = useProductsFilters();         // nuqs URL state
  const productsQuery  = useProducts(/* … filters */);
  const facetsQuery    = useProductFacets(orgId, storeId);
  const { activeSyncs, recentSyncs } = useStoreSyncs(storeId);

  if (orgId === null || storeId === null) return <NoStoreEmptyState />;

  return (
    <>
      <div className="gap-lg flex flex-col">
        <PageHeader
          title={pageTitle}
          intent={pageIntent}
          meta={<SyncBadge … />}                                {/* moved from actions */}
        />
        <ProductsTabStrip
          value={filters.overrideMissing ?? 'all'}
          counts={facetsQuery.data?.overrideCounts}
          loading={facetsQuery.isLoading}
          onChange={(next) => setFilters({ overrideMissing: next === 'all' ? null : next, page: 1 })}
        />
        <ProductsTable
          data={productsQuery.data?.data ?? []}
          loading={productsQuery.isLoading}
          pagination={productsQuery.data?.pagination}
          filters={filters}
          facets={facetsQuery.data}
          onFilterChange={setFilters}
        />
      </div>
      <SyncCenter … />
    </>
  );
}
```

### 6.2 `ProductsTable` — DataTable composition

```tsx
export function ProductsTable({ data, loading, pagination, filters, facets, onFilterChange }) {
  const columns = useMemo<ColumnDef<ProductWithVariants>[]>(() => [
    expandColumn,           // chevron only when row.getCanExpand()
    productColumn,          // image + title + brand · category · model code subtitle
    propertiesColumn,       // sizes summary · color count (multi) | color · size (single)
    barcodeColumn,          // single barcode or "N varyant" badge
    priceColumn,            // range or single, right-aligned, tabular-nums
    stockColumn,            // sum or single, right-aligned
    deliveryColumn,         // dominant + Karışık fallback
    statusColumn,           // dominant + +N overflow
  ], []);

  return (
    <DataTable
      columns={columns}
      data={data}
      loading={loading}
      empty={emptyForCurrentTab(filters)}
      getRowId={(row) => row.id}
      getRowCanExpand={(row) => row.variantCount > 1}
      renderSubComponent={renderVariantRows}                  /* see 6.3 */

      sorting={tanstackSortingFromFilters(filters.sort)}
      onSortingChange={(updater) => onFilterChange({ sort: parseSortUpdater(updater) })}

      paginationState={{ pageIndex: filters.page - 1, pageSize: filters.perPage }}
      onPaginationChange={(updater) => onFilterChange({ page: …, perPage: … })}
      pageCount={pagination?.totalPages ?? 0}
      rowCount={pagination?.total ?? 0}

      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          searchValue={filters.q}                              {/* NEW prop */}
          onSearchChange={(v) => onFilterChange({ q: v, page: 1 })}
          searchPlaceholder={t('filters.searchPlaceholder')}
          facets={
            <ProductsFacetChips
              brand={filters.brandId}
              category={filters.categoryId}
              status={filters.status}
              brandOptions={facets?.brands ?? []}
              categoryOptions={facets?.categories ?? []}
              onBrandChange={(v) => onFilterChange({ brandId: v, page: 1 })}
              onCategoryChange={(v) => onFilterChange({ categoryId: v, page: 1 })}
              onStatusChange={(v) => onFilterChange({ status: v, page: 1 })}
            />
          }
        />
      )}
      pagination={(table) => <DataTablePagination table={table} />}
    />
  );
}
```

### 6.3 Variant row rendering — sub-row alignment

The shared `DataTable` today renders `renderSubComponent` inside a single `colSpan` cell. **It does NOT grid-align**. To make variants share the parent grid we use TanStack v8's native `subRows` + `getSubRows` machinery instead — which renders sub-rows as siblings in the same `<tbody>`, picking up the same column definitions.

This requires a small additive enhancement to `DataTable`:

```tsx
// patterns/data-table.tsx — new optional props (controlled additively)
interface DataTableProps<TData, TValue> {
  // … existing …
  /**
   * When supplied, TanStack treats each row as potentially having
   * sub-rows (e.g. variants under a product). Sub-rows render as
   * sibling <TableRow>s in the same grid as parents — column widths
   * are shared, every cell renders against the same `columns[]`.
   *
   * Pair with row.depth-aware cell renderers (e.g. the leading-cell
   * renderer can switch between chevron at depth 0 and tree connector
   * at depth 1) and TanStack's row.getIsExpanded() to gate sub-row
   * visibility under the parent's expand chevron.
   *
   * Mutually exclusive with renderSubComponent in practice — the two
   * patterns target different visual treatments. Don't use both on
   * the same table.
   */
  getSubRows?: (row: TData) => TData[] | undefined;
}
```

This is a **standalone PR (PR 1)** since the `DataTable` is a shared pattern used by Orders, Settlements, and the showcase. Adding it doesn't break any existing caller — all existing calls don't pass `getSubRows`, so the row-model behavior stays byte-identical.

The product feature then defines column renderers that branch on `row.depth`:

```tsx
const productColumn: ColumnDef<ProductWithVariants> = {
  id: 'product',
  header: () => tCols('title'),
  cell: ({ row }) => {
    if (row.depth === 0) {
      // Parent — compound cell: image + title + subtitle
      return <ProductRowCellParent product={row.original} />;
    }
    // Variant row — indented + tree connector + variant-specific subtitle
    return <ProductRowCellVariant variant={row.original.variants[0]} />;
  },
};

const expandColumn: ColumnDef<ProductWithVariants> = {
  id: 'expand',
  cell: ({ row }) => {
    if (row.depth > 0) {
      // Variant row — tree connector glyph
      return (
        <span className="pt-tree text-muted-foreground" aria-hidden>
          └
        </span>
      );
    }
    if (!row.getCanExpand()) {
      // Single-variant parent — placeholder for column width consistency
      return <span className="size-icon-sm inline-block" aria-hidden />;
    }
    return <ExpandChevronButton row={row} />;
  },
};
```

`getSubRows` projects the variant array onto the same `ProductWithVariants` shape (one variant per pseudo-row), or — cleaner — into a discriminated union. We'll use a discriminated union to keep type safety honest:

```tsx
type ProductRow =
  | { kind: 'parent'; product: ProductWithVariants }
  | { kind: 'variant'; parent: ProductWithVariants; variant: VariantSummary };

function projectToRows(products: ProductWithVariants[]): ProductRow[] {
  return products.map((p) => ({ kind: 'parent', product: p }));
}

const getSubRows = (row: ProductRow): ProductRow[] | undefined => {
  if (row.kind !== 'parent') return undefined;
  if (row.product.variantCount <= 1) return undefined;
  return row.product.variants.map((v) => ({ kind: 'variant', parent: row.product, variant: v }));
};
```

Cells then narrow on `row.original.kind`:

```tsx
const priceColumn: ColumnDef<ProductRow> = {
  id: 'salePrice',
  header: () => tCols('salePrice'),
  meta: { numeric: true },
  enableSorting: true,
  cell: ({ row }) => {
    if (row.original.kind === 'variant') {
      return <Currency value={row.original.variant.salePrice} />;
    }
    const range = priceRange(row.original.product.variants);
    if (range === null) return '—';
    if (range.isSingle) return <Currency value={range.min} />;
    return <PriceRangeDisplay min={range.min} max={range.max} />;
  },
};
```

Variant rows get visual treatment via a row-level data attribute:

```tsx
// patterns/data-table.tsx — when row.depth > 0, set data-depth on TableRow
<TableRow data-depth={row.depth || undefined} … >
```

```css
/* tokens/data-table.css — extend the existing namespace */
[data-depth='1'] {
  background: var(--color-muted);
}
[data-depth='1'] td:first-child {
  padding-left: var(--space-xl);
}
```

### 6.4 Toolbar enhancement — controlled search mode

`apps/web/src/components/patterns/data-table-toolbar.tsx` gains an alternative search prop pair:

```tsx
export interface DataTableToolbarProps<TData> {
  table: Table<TData>;

  /** Bind search to a TanStack column filter (existing behavior). */
  searchColumn?: string;

  /**
   * Controlled-search alternative: bind to a page-level value/onChange
   * pair instead of a column filter. Use for server-paginated pages
   * where search is a query param, not a column filter. Mutually
   * exclusive with searchColumn — pass exactly one.
   */
  searchValue?: string;
  onSearchChange?: (next: string) => void;

  searchPlaceholder?: string;
  onImport?: () => void;
  onExport?: (rows: TData[]) => void;
  facets?: React.ReactNode;
}
```

The render branch picks whichever the caller supplied; if both are supplied, `searchColumn` wins and `onSearchChange` is ignored (logged as a dev-mode warning). This is additive — no existing caller breaks.

Debouncing for controlled mode is the caller's responsibility (matches existing `ProductsFilterBar` pattern: 300ms debounce in the page-client hook before committing to `setFilters`). The toolbar itself is uncontrolled-character-by-character.

### 6.5 `ProductsTabStrip` — new component

Thin wrapper around `FilterTabs`. Exists to centralize tab-options computation and the count-loading skeleton:

```tsx
export type ProductsOverrideTab = 'all' | 'cost' | 'vat';

interface ProductsTabStripProps {
  value: ProductsOverrideTab;
  counts?: { missingCost: number; missingVat: number; total: number };
  loading?: boolean;
  onChange: (next: ProductsOverrideTab) => void;
}

export function ProductsTabStrip(props): React.ReactElement {
  const t = useTranslations('products.overrideTabs');
  const options: FilterTabOption<ProductsOverrideTab>[] = [
    { value: 'all', label: t('all'), count: props.counts?.total },
    { value: 'cost', label: t('missingCost'), count: props.counts?.missingCost },
    { value: 'vat', label: t('missingVat'), count: props.counts?.missingVat },
  ];
  return (
    <FilterTabs
      value={props.value}
      onValueChange={props.onChange}
      options={options}
      loading={props.loading}
    />
  );
}
```

### 6.6 `ProductsFacetChips` — new component

Renders three multi-select chip popovers in the toolbar's `facets` slot. Each is a small, focused composition over `Popover` + `Command` (the shadcn searchable-list primitive). API:

```tsx
interface ProductsFacetChipsProps {
  brand: string; // single-select today; could become multi later
  category: string;
  status: ProductVariantStatus;
  brandOptions: FacetOption[];
  categoryOptions: FacetOption[];
  onBrandChange: (next: string) => void;
  onCategoryChange: (next: string) => void;
  onStatusChange: (next: ProductVariantStatus) => void;
}
```

Each chip renders one of three states:

- **Inactive** (no value): `[+ Marka]` ghost-style chip
- **Active** (one value): `[Marka: Modline ✕]` filled chip with clear affordance
- **Disabled** (no options yet, e.g. facets still loading): `[+ Marka]` skeleton-styled

Status chip is special — its options are a fixed enum (not a long facet list), so it renders as a small dropdown rather than a searchable popover.

### 6.7 `useProductsFilters` — extend nuqs schema

`apps/web/src/features/products/hooks/use-products-filters.ts`:

```ts
const PARSERS = {
  q: parseAsString.withDefault(''),
  status: parseAsStringEnum(PRODUCT_VARIANT_STATUSES).withDefault('onSale'),
  brandId: parseAsString.withDefault(''),
  categoryId: parseAsString.withDefault(''),
  overrideMissing: parseAsStringEnum(['cost', 'vat']), // nullable, no default
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(25),
  sort: parseAsStringEnum([
    '-platformModifiedAt',
    'platformModifiedAt',
    'title',
    '-title',
    'salePrice',
    '-salePrice',
    'totalStock',
    '-totalStock',
  ]).withDefault('-platformModifiedAt'),
};
```

### 6.8 i18n keys (new)

Under `products.*` in `apps/web/messages/tr.json` (and `en.json`):

```jsonc
"products": {
  // … existing …
  "overrideTabs": {
    "all":         "Tümü",
    "missingCost": "Maliyeti girilmemiş",
    "missingVat":  "KDV girilmemiş"
  },
  "empty": {
    // … existing …
    "missingCostNone": "Tüm ürünler için maliyet girilmiş ✓",
    "missingVatNone":  "Tüm ürünler için KDV oranı girilmiş ✓"
  },
  "facets": {
    "brand":      { "trigger": "+ Marka",     "active": "Marka: {name}" },
    "category":   { "trigger": "+ Kategori",  "active": "Kategori: {name}" },
    "status":     { "trigger": "+ Durum",     "active": "Durum: {label}" }
  },
  "columns": {
    // … existing …
    "properties": "Özellikler"
  }
}
```

### 6.9 Realtime / cache invalidation

Untouched. The existing `OrgSyncsProvider` mounts at the dashboard layout; `useStoreSyncs` already drives the SyncBadge. Product cache invalidation on sync-completion is already wired — when a PRODUCTS sync transitions to COMPLETED, the global handler invalidates `productKeys.lists()` + `productFacetsKeys.list()`.

The new `overrideCounts` data lives in the facets response, so the existing facets invalidation covers it.

## 7. Testing

### 7.1 Backend (apps/api)

| Test                                                                                      | Type        | Location                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overrideMissing=cost` returns only products with ≥1 variant having NULL `costPrice`      | Integration | `tests/integration/routes/products-list.routes.test.ts` (existing, extended)                                                                                                                                                                  |
| `overrideMissing=vat` returns only products with ≥1 variant having NULL `vatRate`         | Integration | same                                                                                                                                                                                                                                          |
| `overrideMissing` + `status=onSale` composes via AND                                      | Integration | same                                                                                                                                                                                                                                          |
| `sort=salePrice` orders ascending by max-of-variants price                                | Integration | same                                                                                                                                                                                                                                          |
| `sort=-totalStock` orders descending by `Product.totalStock`                              | Integration | same                                                                                                                                                                                                                                          |
| Facets response includes `overrideCounts: { missingCost, missingVat, total }`             | Integration | `tests/integration/routes/products-facets.routes.test.ts` (new — facets do not have a dedicated route test today; the facet response shape is asserted alongside list tests, but the override-counts addition justifies its own focused file) |
| Tenant isolation: Org A's missing-cost variant does not appear in Org B's override-counts | Integration | `tests/integration/tenant-isolation/products-override.test.ts` (new)                                                                                                                                                                          |

### 7.2 Frontend (apps/web)

| Test                                                                                                          | Type      | Location                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useProducts` includes `overrideMissing` in query params when set                                             | Hook      | `tests/unit/hooks/use-products.test.ts` (existing, extended)                                                                                                                |
| `useProductsFilters` parses `overrideMissing` from URL and writes back                                        | Hook      | `tests/unit/hooks/use-products-filters.test.ts` (existing, extended)                                                                                                        |
| `ProductsTabStrip` renders 3 tabs with formatted counts; clicking a tab calls `onChange` with the right value | Component | `tests/component/products-tab-strip.test.tsx` (new)                                                                                                                         |
| `ProductsTable` renders single-variant product flat (no chevron, parent has lone variant data)                | Component | `tests/component/products-table.test.tsx` (existing — heavily rewritten to match the new composition)                                                                       |
| `ProductsTable` renders multi-variant parent with chevron; clicking expands variant rows in the same grid     | Component | same                                                                                                                                                                        |
| `DataTableToolbar` controlled-search-mode: passes `searchValue` through, calls `onSearchChange` on input      | Component | `tests/component/data-table-toolbar.test.tsx` (new — toolbar does not have a dedicated test today; controlled-search mode justifies one)                                    |
| `DataTable` `getSubRows` renders sub-rows as siblings, picking up parent column defs                          | Component | `tests/component/data-table-subrows.test.tsx` (new — mirrors the per-feature pattern of `data-table-pinning.test.tsx`, `data-table-expandable-rows.test.tsx`, etc.)         |
| `ProductsFacetChips` clears a facet when the active chip's ✕ is clicked                                       | Component | `tests/component/products-facet-chips.test.tsx` (new)                                                                                                                       |
| `ProductsEmptyState` renders the positive empty for `missingCost` tab when there are 0 such products          | Component | `tests/component/products-empty-state.test.tsx` (new — only if the empty-state component grows variants; otherwise asserted inside the rewritten `products-table.test.tsx`) |

### 7.3 Manual smoke

After landing the implementation, run:

1. `pnpm dev --filter web --filter api` → load `/products`. Confirm:
   - Tab counts populate correctly.
   - Switching tabs filters correctly.
   - Search debounces 300ms and updates URL.
   - Brand / Category / Status facet chips toggle correctly.
   - Multi-variant chevron expands → variant rows align with parent grid.
   - Single-variant rows have no chevron, render lone variant inline.
   - Sort by Fiyat / Stok works (and persists across refresh via URL).
   - Pagination respects per-page.
   - Empty states render correctly when filters return 0.
2. Trigger a sync from SyncCenter → confirm tab counts refresh after completion.
3. Switch to dark mode → confirm variant rows tint reads correctly with the inset-highlight token (no muddy alpha trap).

## 8. PR Cuts

To keep the change reviewable, ship as a series of small additive PRs in this order:

| PR    | Title                                                                 | Surface                                                                                                                                                                                                                   |
| ----- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | `feat(db): denormalize Product.totalStock`                            | Schema migration + sync-worker write path + index. ~50 LOC. Independent — could land before brainstorming was even started.                                                                                               |
| **1** | `feat(design-system): DataTable getSubRows mode + data-depth attr`    | Pattern-only PR. Extends `DataTable` with `getSubRows` prop and the `data-depth` attribute. Adds a showcase under `/design/patterns`. No feature consumers yet. ~150 LOC.                                                 |
| **2** | `feat(design-system): DataTableToolbar controlled-search mode`        | Pattern-only PR. Extends `DataTableToolbar` with `searchValue` + `onSearchChange` alternative to `searchColumn`. Adds showcase. ~80 LOC.                                                                                  |
| **3** | `feat(api): products overrideMissing filter + override counts`        | Backend-only PR. Validator + service + tests + OpenAPI sync + changelog. ~250 LOC.                                                                                                                                        |
| **4** | `feat(products): redesigned table with FilterTabs + DataTableToolbar` | The visual redesign. Frontend-only (consumes 1, 2, 3). Replaces `products-table`, `product-variant-table`, `products-filter-bar`, `products-pagination`, `facet-select` with the new composition. ~600 LOC after deletes. |

PRs 0–3 are independently mergeable; PR 4 depends on all of them being on `main`. Expected total cycle: 1 working week.

## 9. Out of Scope (revisit later)

- **Inline cost / desi / KDV editing** (Option C). Schema needs a `desi` column on `ProductVariant` (or a `StoreProductOverride` table if desi behaves differently from cost/KDV). Mutation endpoint, optimistic updates, bulk-action bar, "Maliyet & Desi & KDV girin" derived-profit cell.
- **Excel import / export.** Without inline editing, import has nothing to round-trip. Export-only could ship sooner if requested.
- **Bulk product mapping** (Image #18's "Toplu Ürün Eşleştirme"). Belongs in the future product-mapping feature.
- **Right-pinned column.** Could pin Status if the table grows past 8 columns when Option C lands.
- **Hepsiburada parity.** Out of scope until Hepsiburada sync ships.

## 10. Open Questions

- **Q1 — Should the override-counts respect the current filter state?** Spec assumes no: tabs reset to the unfiltered store-scoped set. Alternative: counts respect q/brand/category/status (so "Maliyetsiz" shows the count among the _currently visible_ set). The reset-to-full-set behavior matches Linear / Notion; the respect-current-filter behavior matches Stripe. Default chosen: **reset to full set**. Confirm.
- **Q2 — Tree connector glyph: `└` and `├`, or a CSS-drawn vertical line?** Glyphs are simpler (no extra tokens, render in any font); CSS lines are crisper at higher DPRs. Default chosen: **glyphs** for v1; revisit if visual polish review flags them.
- **Q3 — Per-page picker default: 25 (today) or 10?** The new compound product cell is taller (~56px vs ~40px) so 25 rows is a longer scroll. Default chosen: **keep 25**. The user can drop to 10 via the picker.
