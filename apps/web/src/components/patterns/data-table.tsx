'use client';

import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnPinningState,
  type ExpandedState,
  type OnChangeFn,
  type PaginationState,
  type Row,
  type RowData,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDataTransferVerticalIcon, ArrowDown01Icon, ArrowUp01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ROW_ACTIONS_COLUMN_ID } from '@/components/patterns/data-table-row-actions';
import {
  TableEmptyState,
  TableErrorState,
  TableNoResultsState,
} from '@/components/patterns/data-table-states';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** Conventional id for a row-selection checkbox column (auto-pinned left). */
const SELECT_COLUMN_ID = 'select';

/**
 * Lets the pagination slot know the body is loading WITHOUT threading a prop
 * through every consumer's render function. On a cold server-paginated load
 * the table instance confidently reports 0 rows / 1 page; DataTablePagination
 * reads this context to show placeholders instead of asserting fake figures
 * (a small trust wobble in a financial product). Provided by DataTable around
 * the `pagination` slot; defaults to false so standalone use is unaffected.
 */
export const DataTableLoadingContext = React.createContext(false);

/**
 * useLayoutEffect on the client so measured pin offsets are corrected BEFORE
 * paint (no visible jump); useEffect on the server where there is nothing to
 * measure — sidesteps React's "useLayoutEffect does nothing on the server"
 * SSR warning. `typeof document` is stable per environment, so this never
 * changes the hook called within a single environment (no hook-order break).
 */
const useIsomorphicLayoutEffect =
  typeof document !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * Keeps the utility columns anchored at the OUTER edges of each pinned side:
 * the select checkbox stays the far-left pinned column, the row-actions kebab
 * stays the far-right one. TanStack's `column.pin('right')` APPENDS, so pinning
 * a data column right would otherwise land it OUTSIDE the actions anchor (to
 * its right, pushing the kebab inward). Re-sorting on every pinning change keeps
 * the anchors outermost. The array order encodes the edge: in `right` the LAST
 * id renders at the far edge (so actions goes last); in `left` the FIRST id is
 * the far edge (so select goes first).
 */
function normalizePinning(pinning: ColumnPinningState): ColumnPinningState {
  const left = pinning.left ?? [];
  const right = pinning.right ?? [];
  const nextLeft = left.includes(SELECT_COLUMN_ID)
    ? [SELECT_COLUMN_ID, ...left.filter((id) => id !== SELECT_COLUMN_ID)]
    : left;
  const nextRight = right.includes(ROW_ACTIONS_COLUMN_ID)
    ? [...right.filter((id) => id !== ROW_ACTIONS_COLUMN_ID), ROW_ACTIONS_COLUMN_ID]
    : right;
  return { left: nextLeft, right: nextRight };
}

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /**
   * Optional tab strip mounted at the very top of the integrated table
   * shell — typically a `FilterTabs` for status/segment filtering. Sits
   * above the toolbar with an inner border-b separator so the whole
   * surface (tabs · toolbar · rows · pagination) reads as one panel.
   */
  tabs?: React.ReactNode;
  /** Optional toolbar receives the table instance for faceted filter controls. */
  toolbar?: (table: TanstackTable<TData>) => React.ReactNode;
  /**
   * Optional pagination footer slot. Mirrors the `toolbar` shape — receives
   * the table instance and renders below the table wrapper. Pair with the
   * shared `DataTablePagination` pattern for the canonical layout, or
   * inline a custom one for feature-specific footers.
   */
  pagination?: (table: TanstackTable<TData>) => React.ReactNode;
  /**
   * Density scale (CSS `zoom`) applied to the table body only — the tabs,
   * toolbar, and pagination stay full size. `1` (default) is a no-op. Lets a
   * seller shrink a wide table's rows/cells so it fits without horizontal
   * scroll; pair with the `TableScaleControl` stepper. NOTE: the
   * scroll-aware pinned-column offsets are measured in the zoomed frame, so
   * this is only sound for tables with at most ONE pinned column per side
   * (a single left/right pin sits at offset 0, unaffected by the scale).
   */
  scale?: number;
  /** Show loading skeletons in place of rows. */
  loading?: boolean;
  /**
   * The body resolves to exactly ONE state via a fixed precedence ladder:
   * `loading` → `error` → zero-rows (no-results when filtered, else first-run)
   * → rows. Each state has its own slot + a sensible default; the slots below
   * let a feature override copy/CTA without re-implementing the ladder.
   *
   * `empty` is the FIRST-RUN state — shown when there are zero rows AND no
   * active filters (genuinely no data yet). Defaults to `TableEmptyState`
   * (inbox icon + sync/connect copy). Back-compat: a table that passes only
   * `empty` and no filter signal keeps the old "any zero rows → empty"
   * behaviour, because `noResultsState` then falls through to `empty`.
   */
  empty?: React.ReactNode;
  /**
   * The NO-RESULTS state — shown when there are zero rows AND filters/search
   * are active. Defaults to `TableNoResultsState` (filter-off icon + a
   * "Clear filters" button wired to `onClearFilters`). DataTable detects the
   * filtered condition from `hasActiveFilters` when supplied, else from
   * TanStack's `columnFilters` (which only reflects CLIENT-side filters — a
   * server-paginated table MUST pass `hasActiveFilters`).
   */
  noResultsState?: React.ReactNode;
  /**
   * Whether the table currently has any active search / filter. Server-filtered
   * tables own this state in URL/props (not in TanStack's `columnFilters`), so
   * they MUST pass it for the no-results vs first-run split to work. Omitted →
   * DataTable falls back to `columnFilters.length > 0` (correct for client-side
   * filtering only).
   */
  hasActiveFilters?: boolean;
  /**
   * Resets the active search + filters. Used by the default no-results state's
   * "Clear filters" button. Omitted → falls back to `table.resetColumnFilters()`
   * (correct only for client-side filtering); server-filtered tables pass their
   * own URL/state reset.
   */
  onClearFilters?: () => void;
  /**
   * Renders an in-body error state (alert icon + retry) ABOVE the zero-rows
   * branch, so a failed fetch never shows the misleading first-run/empty copy.
   * Pair with `onRetry`.
   */
  error?: boolean;
  /** Re-runs the failed query. Wires the error state's "Try again" button. */
  onRetry?: () => void;
  /**
   * Hide the `toolbar` in the genuine first-run state only (zero rows, no
   * filters, not loading, not error) — search/filter controls over a "connect
   * your store" screen read as broken. The toolbar STAYS mounted in loading,
   * error, and no-results (where the user needs it to retry / clear filters).
   * Default `false` (toolbar always shown) to avoid surprising existing layouts.
   */
  hideToolbarOnEmpty?: boolean;
  /** Enable row selection checkboxes (column must be defined separately). */
  enableRowSelection?: boolean;
  /** Row id accessor for stable selection state across re-renders. */
  getRowId?: (row: TData, index: number) => string;
  /**
   * Per-row predicate that decides whether a row can be expanded. When
   * supplied alongside `renderSubComponent`, expandable rows render an
   * inline sub-row below themselves. Defaults to off — existing tables
   * unaffected.
   */
  getRowCanExpand?: (row: Row<TData>) => boolean;
  /**
   * Renders the expanded sub-row content. Receives the parent row so
   * the sub-component can render related data (e.g. variant rows under
   * a parent product).
   */
  renderSubComponent?: (row: Row<TData>) => React.ReactNode;
  /**
   * Project a parent row's children to render as sibling sub-rows in
   * the same grid (TanStack v8 native subRows machinery). When
   * supplied, sub-rows pick up the parent's column definitions
   * verbatim — column widths align, every cell is rendered against the
   * same `columns[]`. Combine with `row.depth` in your column cell
   * renderers to branch parent vs child rendering, and with
   * `row.getIsExpanded()` (gated by the chevron in your expand column)
   * to toggle visibility.
   *
   * Mutually exclusive in spirit with `renderSubComponent`: the two
   * patterns target different visual treatments (sibling rows vs
   * panel inside a colspan cell). Don't combine them on the same
   * table.
   */
  getSubRows?: (row: TData) => TData[] | undefined;
  /**
   * Initial column pinning state — handy when the page wants a few
   * columns pinned by default (e.g. the select-checkbox always on the
   * left). Each entry is a column id. Ignored when `columnPinning` is
   * supplied (controlled mode).
   */
  initialColumnPinning?: ColumnPinningState;
  /**
   * Controlled column-pinning state. When supplied alongside
   * `onColumnPinningChange`, DataTable hands ownership to the parent
   * (e.g. for nuqs / URL state). Otherwise pinning lives in local
   * useState seeded from `initialColumnPinning`.
   */
  columnPinning?: ColumnPinningState;
  onColumnPinningChange?: OnChangeFn<ColumnPinningState>;
  /**
   * Fires when the user activates a row by mouse click or keyboard
   * (Enter / Space). The handler receives the row's `original` data
   * plus the source event. Activation deliberately ignores clicks
   * that originate inside an interactive descendant — buttons,
   * links, inputs, labels, and elements carrying ARIA roles like
   * `button` / `checkbox` / `menuitem` / `link` / `switch` / `tab` /
   * `option`, plus anything tagged `data-row-action`. Use the
   * `data-row-action` opt-out on a custom interactive element if it
   * doesn't fit the default rule (e.g. a hover-revealed quick-action
   * that's just a styled `<span>`).
   *
   * When supplied, rows become tab-focusable with `role="button"`,
   * gain a focus-visible ring + `cursor-pointer`, and respond to
   * Enter / Space the same way they do to mouse clicks. Omitted →
   * rows stay fully passive (no role, no cursor change, no focus
   * ring change).
   */
  onRowClick?: (row: TData, event: React.MouseEvent | React.KeyboardEvent) => void;
  /**
   * Controlled sorting state. When supplied alongside `onSortingChange`
   * DataTable hands ownership to the parent and flips TanStack into
   * `manualSorting: true` — the parent forwards the next sort to the
   * server (e.g. via React Query) and feeds the response back as `data`.
   * Omit both to keep the original client-side sorting behaviour.
   */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /**
   * Initial (uncontrolled) sort seed. Mirrors `initialColumnPinning`: seeds the
   * internal sorting state once at mount so a table can declare a default sort
   * (e.g. units desc) with the sort arrow shown. Ignored when the controlled
   * `sorting` prop is supplied (which flips manualSorting and disables the
   * client-side sort model).
   */
  initialSorting?: SortingState;
  /**
   * Controlled column-filter state. Same controlled-when-supplied
   * pattern as `sorting` — supplying both flips `manualFiltering: true`
   * and the parent owns the filter pipeline (typically forwarded into
   * the API request). DataTableToolbar's search input + faceted filters
   * still emit through `setFilterValue`, which calls back here.
   */
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: OnChangeFn<ColumnFiltersState>;
  /**
   * Controlled pagination state. Supplying it (together with
   * `onPaginationChange` and a `pageCount` / `rowCount`) flips
   * `manualPagination: true` — DataTable trusts that `data` is already
   * the current page's slice and uses `pageCount` to size the page-nav
   * controls. The matching `DataTablePagination` footer reads the same
   * values from the table instance so it works unchanged.
   *
   * Note the suffix: `paginationState` (not `pagination`) avoids
   * colliding with the existing `pagination` render-prop slot
   * introduced in PR 1 of this series.
   */
  paginationState?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;
  /**
   * Total page count for server-paginated mode. Required when
   * `paginationState` is controlled — used to compute "Sayfa X / Y"
   * and to enable / disable the next + last buttons. Pass either
   * this or `rowCount` (TanStack derives the other if you give it
   * one); supplying both is fine and avoids a one-page rounding edge.
   */
  pageCount?: number;
  /**
   * Total row count for server-paginated mode. Drives the "X / N satır"
   * summary in DataTablePagination and lets TanStack derive `pageCount`
   * when it isn't supplied.
   */
  rowCount?: number;
  /**
   * Optional floating action bar slot. Receives the table instance so it
   * can read selection state (`table.getSelectedRowModel()`) and fire
   * deselect (`table.resetRowSelection()`). Rendered outside the bordered
   * card shell so it overlays the page rather than being clipped. Typically
   * used for bulk-operation bars (BulkActionBar) visible when rows are selected.
   */
  fab?: (table: TanstackTable<TData>) => React.ReactNode;
}

/**
 * Thin wrapper over TanStack Table v8 with shadcn-style primitives and
 * PazarSync tokens. Opinionated defaults: sticky header, hover affordance,
 * sortable columns surface an icon, numeric columns (data-numeric=true on
 * header/cell) right-align via CSS. Pair with DataTableToolbar above for
 * the canonical search + filter + import/export + column-visibility row.
 *
 * Scope of this initial version: client-side sort/filter/select. Server-side
 * pagination + virtualization are implementation concerns wired per-feature
 * (orders page, settlements page) rather than baked in here — each feature
 * has different pagination semantics.
 *
 * @useWhen rendering a sortable, filterable, optionally selectable or expandable data table (pair with DataTableToolbar for the standard top row)
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  tabs,
  toolbar,
  pagination,
  scale = 1,
  loading = false,
  empty,
  noResultsState,
  hasActiveFilters,
  onClearFilters,
  error = false,
  onRetry,
  hideToolbarOnEmpty = false,
  enableRowSelection = false,
  getRowId,
  getRowCanExpand,
  renderSubComponent,
  getSubRows,
  initialColumnPinning,
  columnPinning,
  onColumnPinningChange,
  onRowClick,
  sorting,
  onSortingChange,
  initialSorting,
  columnFilters,
  onColumnFiltersChange,
  paginationState,
  onPaginationChange,
  pageCount,
  rowCount,
  fab,
}: DataTableProps<TData, TValue>): React.ReactElement {
  const t = useTranslations('common.dataTable');
  // Each of these triples follows the same controlled-when-supplied
  // contract: presence of the prop hands ownership to the parent and
  // flips the matching `manualX` flag on TanStack so it stops doing
  // client-side X work and trusts the values it's given. Absence keeps
  // the original client-side behaviour byte-identical.
  const [internalSorting, setInternalSorting] = React.useState<SortingState>(initialSorting ?? []);
  const [internalColumnFilters, setInternalColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [internalPagination, setInternalPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});
  const [expanded, setExpanded] = React.useState<ExpandedState>({});
  // Internal pinning state used only when caller didn't lift it. Seed
  // from `initialColumnPinning` so a feature page can declare "select
  // column starts pinned-left" once at mount.
  const [internalPinning, setInternalPinning] = React.useState<ColumnPinningState>(() => {
    if (initialColumnPinning !== undefined) return normalizePinning(initialColumnPinning);
    // Default: pin the UTILITY columns so the row checkbox stays on the left and
    // the row-actions kebab on the right during horizontal scroll. Identity /
    // data columns are opt-in — a feature passes `initialColumnPinning` to add
    // its own anchor column (which then overrides this default entirely).
    const left = columns.some((column) => column.id === SELECT_COLUMN_ID) ? [SELECT_COLUMN_ID] : [];
    const right = columns.some((column) => column.id === ROW_ACTIONS_COLUMN_ID)
      ? [ROW_ACTIONS_COLUMN_ID]
      : [];
    return { left, right };
  });

  const isPinningControlled = columnPinning !== undefined;
  const isSortingControlled = sorting !== undefined;
  const isFilteringControlled = columnFilters !== undefined;
  const isPaginationControlled = paginationState !== undefined;

  const handlePinningChange: OnChangeFn<ColumnPinningState> = (updater) => {
    // Resolve the updater, then re-anchor the utility columns to the outer edges
    // (TanStack's column.pin() appends, which would drop a freshly-pinned column
    // outside the select/actions anchors).
    const resolve = (prev: ColumnPinningState): ColumnPinningState =>
      normalizePinning(typeof updater === 'function' ? updater(prev) : updater);
    if (isPinningControlled) {
      onColumnPinningChange?.(resolve(columnPinning ?? { left: [], right: [] }));
    } else {
      setInternalPinning(resolve);
    }
  };
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    if (isSortingControlled) {
      onSortingChange?.(updater);
    } else {
      setInternalSorting(updater);
    }
  };
  const handleColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
    if (isFilteringControlled) {
      onColumnFiltersChange?.(updater);
    } else {
      setInternalColumnFilters(updater);
    }
  };
  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    if (isPaginationControlled) {
      onPaginationChange?.(updater);
    } else {
      setInternalPagination(updater);
    }
  };

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting: isSortingControlled ? sorting : internalSorting,
      columnFilters: isFilteringControlled ? columnFilters : internalColumnFilters,
      pagination: isPaginationControlled ? paginationState : internalPagination,
      columnVisibility,
      rowSelection,
      expanded,
      columnPinning: isPinningControlled ? columnPinning : internalPinning,
    },
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: handleColumnFiltersChange,
    onPaginationChange: handlePaginationChange,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onExpandedChange: setExpanded,
    onColumnPinningChange: handlePinningChange,
    getCoreRowModel: getCoreRowModel(),
    // Drop the matching client-side row model when the caller is in
    // controlled mode for that axis — TanStack expects to be the only
    // source of truth in manual mode and will warn if a row model also
    // tries to compute the slice.
    getSortedRowModel: isSortingControlled ? undefined : getSortedRowModel(),
    getFilteredRowModel: isFilteringControlled ? undefined : getFilteredRowModel(),
    getPaginationRowModel: isPaginationControlled ? undefined : getPaginationRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    manualSorting: isSortingControlled,
    manualFiltering: isFilteringControlled,
    manualPagination: isPaginationControlled,
    // Keep the current page when `data` merely gets a NEW ARRAY REFERENCE without a
    // content change. TanStack defaults this to `!manualPagination` (i.e. ON for our
    // client-paginated tables): its core row-model memo keys on the `data` reference and,
    // on any change, queues a `resetPageIndex()` in a microtask. Feature tables re-derive
    // and often spread their rows (`data={[...rows]}`) on every render, so an UNRELATED
    // re-render — e.g. a live what-if estimate landing while the seller is on page 2 —
    // produced a fresh array and silently bounced them back to page 1. Row identity is
    // already stable via `getRowId`, so paging state is safe to retain across these
    // reference churns. Server-paginated tables are unaffected (TanStack already defaults
    // this OFF when `manualPagination` is true). Trade-off: a client-side filter that
    // shrinks the set no longer auto-returns to page 1 — features owning the filtered
    // `data` reset their own page when that matters.
    autoResetPageIndex: false,
    pageCount: isPaginationControlled ? pageCount : undefined,
    rowCount: isPaginationControlled ? rowCount : undefined,
    enableRowSelection,
    // Single-column sort only. Shift-click multi-sort is off because the server
    // marshalling keeps just the first key — leaving it on would let a user
    // build a multi-sort the backend silently truncates.
    enableMultiSort: false,
    getRowId,
    getRowCanExpand,
    getSubRows,
  });

  // Single source for cell-count math: the visible LEAF columns. Drives the
  // empty-state + expanded-row colSpan AND the loading skeleton, so hiding a
  // column can never desync the three against the rendered header/rows.
  const visibleLeafColumns = table.getVisibleLeafColumns();
  const visibleLeafCount = visibleLeafColumns.length;
  const selectedCount = Object.keys(rowSelection).length;
  // Skeleton fills the page rhythm without flooding the DOM on large page sizes.
  const skeletonRowCount = Math.min(table.getState().pagination.pageSize, 12);

  // Body precedence ladder, resolved ONCE so the toolbar-hide rule and the
  // TableBody render agree on a single state: loading > error > zero-rows
  // (no-results when filtered, else first-run) > rows.
  const rowsCount = table.getRowModel().rows.length;
  const isFiltered = hasActiveFilters ?? table.getState().columnFilters.length > 0;
  const bodyState: 'loading' | 'error' | 'noResults' | 'empty' | 'rows' = loading
    ? 'loading'
    : error
      ? 'error'
      : rowsCount === 0
        ? isFiltered
          ? 'noResults'
          : 'empty'
        : 'rows';
  // First-run only: hide the toolbar so dead search/filter controls don't sit
  // over a "connect your store" screen. Opt-in (default off) to avoid surprising
  // existing layouts; the toolbar stays mounted in loading / error / no-results.
  const showToolbar = toolbar !== undefined && !(hideToolbarOnEmpty && bodyState === 'empty');

  // Pinned-column sticky offsets are MEASURED from real rendered widths
  // rather than trusting TanStack's column-size model. getStart('left') /
  // getAfter('right') accumulate each column's getSize() (default 150px),
  // which is wrong for our content-width columns: the 2nd+ pinned column on
  // a side would stick at a 150px multiple instead of right after its
  // neighbour, opening a gap that scrolling content shows through. The layout
  // effect reads each pinned header cell's offsetWidth and accumulates the
  // true offset; computePinningProps falls back to getStart/getAfter for the
  // first paint and SSR (corrected pre-paint by the effect, so no jump).
  const tableRef = React.useRef<HTMLTableElement>(null);
  const [pinOffsets, setPinOffsets] = React.useState<Record<string, number>>({});
  const activePinning = isPinningControlled ? columnPinning : internalPinning;
  const pinSignature = `${activePinning.left?.join(',') ?? ''}|${activePinning.right?.join(',') ?? ''}`;

  useIsomorphicLayoutEffect(() => {
    const el = tableRef.current;
    if (el === null) return;
    const measure = (): void => {
      const headRow = el.querySelector('thead tr');
      if (headRow === null) return;
      const cells = Array.from(headRow.children);
      const next: Record<string, number> = {};
      // Accumulate FRACTIONAL widths (getBoundingClientRect, not the integer
      // offsetWidth): rounding each column to a whole pixel drifts the running
      // offset, so a 2nd/3rd pinned column on a side lands a fraction of a pixel
      // short of its neighbour and a hairline of table background shows through
      // the seam. A 1px overlap would mask it, but exact fractional offsets fix
      // it properly.
      let leftAcc = 0;
      for (const cell of cells) {
        if (!(cell instanceof HTMLElement) || cell.dataset.pinnedSide !== 'left') continue;
        if (cell.dataset.colId !== undefined) next[`l:${cell.dataset.colId}`] = leftAcc;
        leftAcc += cell.getBoundingClientRect().width;
      }
      let rightAcc = 0;
      for (let i = cells.length - 1; i >= 0; i -= 1) {
        const cell = cells[i];
        if (!(cell instanceof HTMLElement) || cell.dataset.pinnedSide !== 'right') continue;
        if (cell.dataset.colId !== undefined) next[`r:${cell.dataset.colId}`] = rightAcc;
        rightAcc += cell.getBoundingClientRect().width;
      }
      // Only commit when something actually moved — setState in a layout effect
      // would otherwise loop (re-render → effect → setState → …).
      setPinOffsets((prev) => {
        const keys = Object.keys(next);
        const unchanged =
          keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]);
        return unchanged ? prev : next;
      });
    };
    measure();
    // Re-measure when a column's content width changes (the inner table
    // resizing) without a pinning/column/data change of its own.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pinSignature, columns.length, data.length]);

  return (
    // Integrated table shell — `tabs` (optional) → `toolbar` (optional) →
    // table rows → `pagination` (optional) all live inside one bordered,
    // rounded surface. Internal `border-b` / `border-t` dividers separate
    // the zones so the whole control surface reads as one panel instead
    // of four floating siblings. The shell uses bg-card + shadow-xs — the
    // same standing-panel treatment as Card — so it reads as a raised
    // surface on the tinted canvas rather than an outline drawn on it.
    <>
      {/* animate-panel-enter-delayed: the shell follows the page's KPI strip
          by one 50ms beat on mount (liveliness layer) — never replays on
          re-render, collapses under prefers-reduced-motion. */}
      <div className="border-border bg-card animate-panel-enter-delayed overflow-hidden rounded-lg border shadow-xs">
        {/* Polite live regions: a screen reader hears the selection count and
            the loading state change without a visible duplicate. One status per
            concern; both empty when inactive so nothing is announced at rest. */}
        {enableRowSelection ? (
          <div role="status" aria-live="polite" className="sr-only">
            {selectedCount > 0 ? t('selection.selectedCount', { count: selectedCount }) : ''}
          </div>
        ) : null}
        <div role="status" aria-live="polite" className="sr-only">
          {loading ? t('loading') : ''}
        </div>
        {tabs ? <div className="border-border px-md pt-sm pb-2xs border-b">{tabs}</div> : null}
        {showToolbar ? (
          <div className="border-border px-md py-sm border-b">{toolbar?.(table)}</div>
        ) : null}
        {/* Table owns the single horizontal-scroll container (scrollAware wires
            the scroll-position data attributes the pinned-edge shadows react
            to). No extra overflow wrapper — a second one would double-clip and
            steal the sticky-pinning scroll context. */}
        <Table
          ref={tableRef}
          scrollAware
          aria-busy={loading || undefined}
          // runtime-dynamic: seller-controlled density zoom on the table body
          // only; the scroll container above stays full-width so scaling the
          // content lets a wide table fit without horizontal scroll.
          style={scale === 1 ? undefined : { zoom: scale }}
        >
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isNumeric = header.column.columnDef.meta?.numeric === true;
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  const pinning = computePinningProps(header.column, pinOffsets);
                  return (
                    <TableHead
                      key={header.id}
                      data-numeric={isNumeric || undefined}
                      aria-sort={
                        canSort
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : sortDir === 'desc'
                              ? 'descending'
                              : 'none'
                          : undefined
                      }
                      className={cn(
                        isNumeric && 'text-right',
                        // Active-sorted column carries a faint persistent tile
                        // (one step under the header band) so the sorted column
                        // is legible at a glance.
                        sortDir !== false && 'bg-muted',
                        // Sortable header drops its cell padding so the button
                        // can fill the WHOLE cell (the entire header is the hit
                        // target); the button re-adds px-sm.
                        canSort && 'p-0',
                      )}
                      {...pinning}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            // Fill the entire header cell so the WHOLE header is
                            // the sort hit target (the th drops its padding; the
                            // button re-adds px-sm).
                            'group/sortbtn px-sm gap-3xs duration-fast flex h-10 w-full items-center transition-colors',
                            // Touch floor: a 44px tap target under a coarse pointer
                            // (the header row grows to fit on touch devices).
                            'pointer-coarse:min-h-11',
                            // Hover tile = bg-muted, one step darker than the
                            // bg-surface-subtle band; bg-background was lighter
                            // than the band and read as a hole punched in it.
                            'hover:bg-muted',
                            // Inset ring — the table's nested overflow containers
                            // clip the global outset focus glow; matches the row +
                            // pin-button focus idiom so the focused header is visible.
                            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                            // The sort indicator ALWAYS trails the label (same
                            // side on every column); numeric headers just
                            // right-align the label+icon group over their figures.
                            isNumeric ? 'justify-end' : 'justify-start',
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortDir === 'asc' ? (
                            <ArrowUp01Icon className="size-icon-xs text-foreground shrink-0" />
                          ) : sortDir === 'desc' ? (
                            <ArrowDown01Icon className="size-icon-xs text-foreground shrink-0" />
                          ) : (
                            // Reveal-on-intent: an up/down "sortable both ways"
                            // hint — hidden at rest, shown at FULL strength on
                            // hover or keyboard focus (muted-foreground, matching
                            // the label). The active column keeps a solid,
                            // foreground-strength arrow so the sort pops.
                            <ArrowDataTransferVerticalIcon className="size-icon-xs shrink-0 opacity-0 transition-opacity group-hover/sortbtn:opacity-100 group-focus-visible/sortbtn:opacity-100" />
                          )}
                          <span className="sr-only">
                            {sortDir === 'asc'
                              ? t('sort.ascending')
                              : sortDir === 'desc'
                                ? t('sort.descending')
                                : t('sort.sortable')}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {bodyState === 'loading' ? (
              Array.from({ length: skeletonRowCount }).map((_, rowIdx) => (
                // pointer-events-none makes the skeleton row truly
                // non-interactive: no :hover fires, so neither the row's own
                // hover tint NOR the pinned-cell mirror
                // (group-hover/row:bg-surface-row-hover on the td, which a
                // row-level hover:bg-transparent cannot cancel) can light up a
                // row that cannot be clicked. hover:bg-transparent is kept as a
                // belt-and-braces no-op for the unpinned cells.
                <TableRow
                  key={`skeleton-${rowIdx}`}
                  className="pointer-events-none hover:bg-transparent"
                >
                  {visibleLeafColumns.map((column, colIdx) => {
                    const isNumeric = column.columnDef.meta?.numeric === true;
                    // Pinned columns keep their sticky/opaque treatment while
                    // loading so a horizontally-scrolled skeleton behaves like
                    // the loaded table (headers stick — bodies must too).
                    const pinning = computePinningProps(column, pinOffsets);
                    return (
                      <TableCell
                        key={column.id}
                        data-numeric={isNumeric || undefined}
                        className={cn(isNumeric && 'text-right')}
                        {...pinning}
                      >
                        <CellSkeleton
                          shape={column.columnDef.meta?.skeleton}
                          numeric={isNumeric}
                          seed={rowIdx + colIdx}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : bodyState === 'error' ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleLeafCount} className="p-0">
                  <div className="min-h-table-empty flex items-center justify-center">
                    <TableErrorState onRetry={onRetry} />
                  </div>
                </TableCell>
              </TableRow>
            ) : bodyState === 'noResults' ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleLeafCount} className="p-0">
                  <div className="min-h-table-empty flex items-center justify-center">
                    {noResultsState ?? empty ?? (
                      <TableNoResultsState
                        onClearFilters={onClearFilters ?? (() => table.resetColumnFilters())}
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : bodyState === 'empty' ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleLeafCount} className="p-0">
                  <div className="min-h-table-empty flex items-center justify-center">
                    {empty ?? <TableEmptyState />}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => {
                const handleRowClick = onRowClick
                  ? (event: React.MouseEvent<HTMLTableRowElement>) => {
                      if (isInteractiveDescendant(event.target, event.currentTarget)) return;
                      onRowClick(row.original, event);
                    }
                  : undefined;
                const handleRowKeyDown = onRowClick
                  ? (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      if (isInteractiveDescendant(event.target, event.currentTarget)) return;
                      // Stop Space from scrolling and Enter from re-activating
                      // the focused row twice via bubbling.
                      event.preventDefault();
                      onRowClick(row.original, event);
                    }
                  : undefined;
                return (
                  <React.Fragment key={row.id}>
                    <TableRow
                      data-state={row.getIsSelected() ? 'selected' : undefined}
                      data-depth={row.depth || undefined}
                      // Anchors the parent visually to its open sub-panel:
                      // both paint bg-muted (ui/table.tsx) so they read as one
                      // opened zone in a long table.
                      data-expanded={
                        (row.getIsExpanded() && renderSubComponent !== undefined) || undefined
                      }
                      // Gates the :active press tint to rows that actually
                      // navigate (see ui/table.tsx state ladder).
                      data-clickable={onRowClick !== undefined || undefined}
                      role={onRowClick ? 'button' : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                      onClick={handleRowClick}
                      onKeyDown={handleRowKeyDown}
                      className={cn(
                        onRowClick &&
                          // The focus ring is painted on an overlay pseudo-element
                          // ABOVE the sticky pinned cells (z-10) so it wraps the
                          // whole row continuously instead of being clipped by the
                          // opaque select / actions cell backgrounds at the edges.
                          // shadow-none suppresses the GLOBAL :focus-visible glow
                          // (globals.css box-shadow: var(--shadow-focus)) so only
                          // the crisp ::after ring shows — without it the row got a
                          // second, softer border stacked over the ring. The ring
                          // is square (rows are rectangular); a rounded ring reads
                          // wrong mid-table. A bare table's last row can be sliced
                          // by the shell's rounded overflow, but every real table
                          // has a toolbar / pagination occupying those corners.
                          "focus-visible:after:ring-ring relative cursor-pointer focus-visible:shadow-none focus-visible:outline-none focus-visible:after:pointer-events-none focus-visible:after:absolute focus-visible:after:inset-0 focus-visible:after:z-20 focus-visible:after:ring-2 focus-visible:after:content-[''] focus-visible:after:ring-inset",
                      )}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const isNumeric = cell.column.columnDef.meta?.numeric === true;
                        const pinning = computePinningProps(cell.column, pinOffsets);
                        return (
                          <TableCell
                            key={cell.id}
                            data-numeric={isNumeric || undefined}
                            className={cn(isNumeric && 'text-right')}
                            {...pinning}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                    {row.getIsExpanded() && renderSubComponent !== undefined ? (
                      <TableRow data-expanded-content="true" className="hover:bg-transparent">
                        <TableCell colSpan={visibleLeafCount} className="bg-muted p-0">
                          {renderSubComponent(row)}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
        {pagination ? (
          <div className="border-border px-md py-sm border-t">
            <DataTableLoadingContext.Provider value={bodyState === 'loading'}>
              {pagination(table)}
            </DataTableLoadingContext.Provider>
          </div>
        ) : null}
      </div>
      {fab ? fab(table) : null}
    </>
  );
}

/**
 * Tags / roles whose presence in the click target's ancestor chain
 * means the click was meant for a child control, not the row itself.
 * Used by `onRowClick` so a click on a checkbox, sort-header button,
 * inline action button, or `<a>` link doesn't double-fire as a row
 * activation. Components needing a one-off opt-out (e.g. a styled
 * `<span>` that's actually clickable) can set `data-row-action` on
 * the element to participate in the same exclusion.
 */
const INTERACTIVE_ROW_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL']);
const INTERACTIVE_ROW_ROLES = new Set([
  'button',
  'checkbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'link',
  'switch',
  'tab',
  'option',
]);

function isInteractiveDescendant(target: EventTarget | null, rowEl: HTMLElement): boolean {
  if (!(target instanceof HTMLElement)) return false;
  let node: HTMLElement | null = target;
  while (node !== null && node !== rowEl) {
    if (INTERACTIVE_ROW_TAGS.has(node.tagName)) return true;
    if (node.hasAttribute('data-row-action')) return true;
    const role = node.getAttribute('role');
    if (role !== null && INTERACTIVE_ROW_ROLES.has(role)) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Derives the data-attribute + inline-style props that turn a TableHead
 * or TableCell into a sticky pinned column. Returns nothing when the
 * column isn't pinned, so the spread is a no-op for unpinned cells.
 *
 * The offset (`left:` for left-pinned, `right:` for right-pinned) is
 * runtime-dynamic — it depends on the cumulative width of pinned columns
 * earlier in the stack. It comes from `pinOffsets` (measured real widths,
 * keyed `l:<id>` / `r:<id>`), falling back to TanStack's getStart/getAfter
 * for the first paint + SSR. `data-col-id` lets the measuring layout effect
 * map each pinned header cell back to its column. See CLAUDE.md "no one-off
 * magic values" → "the one exception" for why inline style is right here.
 */
function computePinningProps<TData, TValue>(
  column: Column<TData, TValue>,
  pinOffsets: Record<string, number>,
): {
  'data-pinned-side'?: 'left' | 'right';
  'data-pinned-edge'?: 'last-left' | 'first-right';
  'data-col-id'?: string;
  style?: React.CSSProperties;
} {
  const side = column.getIsPinned();
  if (side === false) return {};
  const isLastLeft = side === 'left' && column.getIsLastColumn('left');
  const isFirstRight = side === 'right' && column.getIsFirstColumn('right');
  // runtime-dynamic: sticky offset is the measured cumulative width of
  // earlier pinned columns; can't be tokenized. Fall back to the size-model
  // start/after until the layout effect measures (pre-paint, so no jump).
  const measured = pinOffsets[`${side === 'left' ? 'l' : 'r'}:${column.id}`];
  const offset = measured ?? (side === 'left' ? column.getStart('left') : column.getAfter('right'));
  const style: React.CSSProperties = side === 'left' ? { left: offset } : { right: offset };
  return {
    'data-pinned-side': side,
    'data-pinned-edge': isLastLeft ? 'last-left' : isFirstRight ? 'first-right' : undefined,
    'data-col-id': column.id,
    style,
  };
}

/* Deterministic per-cell width variation so the loading table previews "text
   of differing lengths" instead of a rigid barcode wall of identical bars.
   Cycled by (rowIdx + colIdx) — a pure function of indices, byte-identical
   between server and client render (Math.random would break hydration). */
const TEXT_SKELETON_WIDTHS = ['w-4/5', 'w-3/5', 'w-2/3'] as const;
const NUMERIC_SKELETON_WIDTHS = ['w-16', 'w-12', 'w-14'] as const;

function CellSkeleton({
  shape,
  numeric,
  seed,
}: {
  shape: 'checkbox' | 'thumb' | 'identity' | 'none' | undefined;
  numeric: boolean;
  seed: number;
}): React.ReactElement | null {
  switch (shape) {
    case 'checkbox':
      return <Skeleton className="size-4" />;
    case 'thumb':
      return <Skeleton radius="md" className="size-thumb-lg" />;
    case 'identity':
      return (
        <div className="gap-sm flex items-center">
          <Skeleton radius="md" className="size-thumb-lg shrink-0" />
          <div className="gap-2xs flex min-w-0 flex-1 flex-col">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      );
    case 'none':
      return null;
    case undefined:
      return (
        <Skeleton
          className={cn(
            'h-4',
            numeric
              ? cn('ml-auto', NUMERIC_SKELETON_WIDTHS[seed % NUMERIC_SKELETON_WIDTHS.length])
              : TEXT_SKELETON_WIDTHS[seed % TEXT_SKELETON_WIDTHS.length],
          )}
        />
      );
    default: {
      const _exhaustive: never = shape;
      throw new Error(`Unhandled skeleton shape: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Extend TanStack's ColumnMeta so `meta: { numeric: true }` type-checks
 * and drives right-alignment + tabular-nums styling via data attributes.
 */
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    numeric?: boolean;
    /**
     * Human-readable column name for the column-visibility menu and any
     * a11y label. Required when `header` is not a plain string (e.g. a
     * function/element header) — otherwise the menu would fall back to the
     * raw machine `id` (`grossAmount`) instead of a localized label (`Ciro`).
     * See `resolveColumnLabel` in data-table-toolbar.tsx.
     */
    label?: string;
    /**
     * Skeleton shape for the loading state. Without a hint every cell renders
     * a text bar — fine for text/numbers, but a 56px product-image column
     * previewed as a 16px bar means every row grows ~2.5× when data lands.
     *   'checkbox' → selection-checkbox square
     *   'thumb'    → product-image square (--size-thumb-lg)
     *   'identity' → thumb + two stacked text lines (image-and-name cells)
     *   'none'     → empty cell (e.g. a hover-only actions column)
     * Text/numeric columns need no hint; they derive from `numeric`.
     */
    skeleton?: 'checkbox' | 'thumb' | 'identity' | 'none';
  }
}
