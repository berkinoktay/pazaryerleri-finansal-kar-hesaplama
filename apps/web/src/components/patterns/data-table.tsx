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
import { ArrowDown01Icon, ArrowUp01Icon, SortingDownIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
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

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Optional toolbar receives the table instance for faceted filter controls. */
  toolbar?: (table: TanstackTable<TData>) => React.ReactNode;
  /**
   * Optional pagination footer slot. Mirrors the `toolbar` shape — receives
   * the table instance and renders below the table wrapper. Pair with the
   * shared `DataTablePagination` pattern for the canonical layout, or
   * inline a custom one for feature-specific footers.
   */
  pagination?: (table: TanstackTable<TData>) => React.ReactNode;
  /** Show loading skeletons in place of rows. */
  loading?: boolean;
  /** Custom content when the table has zero rows post-filter. */
  empty?: React.ReactNode;
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
  toolbar,
  pagination,
  loading = false,
  empty,
  enableRowSelection = false,
  getRowId,
  getRowCanExpand,
  renderSubComponent,
  initialColumnPinning,
  columnPinning,
  onColumnPinningChange,
  onRowClick,
  sorting,
  onSortingChange,
  columnFilters,
  onColumnFiltersChange,
  paginationState,
  onPaginationChange,
  pageCount,
  rowCount,
}: DataTableProps<TData, TValue>): React.ReactElement {
  const t = useTranslations('common.dataTable.empty');
  // Each of these triples follows the same controlled-when-supplied
  // contract: presence of the prop hands ownership to the parent and
  // flips the matching `manualX` flag on TanStack so it stops doing
  // client-side X work and trusts the values it's given. Absence keeps
  // the original client-side behaviour byte-identical.
  const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
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
  const [internalPinning, setInternalPinning] = React.useState<ColumnPinningState>(
    () => initialColumnPinning ?? { left: [], right: [] },
  );

  const isPinningControlled = columnPinning !== undefined;
  const isSortingControlled = sorting !== undefined;
  const isFilteringControlled = columnFilters !== undefined;
  const isPaginationControlled = paginationState !== undefined;

  const handlePinningChange: OnChangeFn<ColumnPinningState> = (updater) => {
    if (isPinningControlled) {
      onColumnPinningChange?.(updater);
    } else {
      setInternalPinning(updater);
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
    pageCount: isPaginationControlled ? pageCount : undefined,
    rowCount: isPaginationControlled ? rowCount : undefined,
    enableRowSelection,
    getRowId,
    getRowCanExpand,
  });

  return (
    <div className="gap-md flex flex-col">
      {toolbar ? toolbar(table) : null}
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isNumeric = header.column.columnDef.meta?.numeric === true;
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  const pinning = computePinningProps(header.column);
                  return (
                    <TableHead
                      key={header.id}
                      data-numeric={isNumeric || undefined}
                      className={cn(isNumeric && 'text-right')}
                      {...pinning}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            'gap-3xs px-3xs py-3xs -mx-3xs duration-fast inline-flex items-center rounded-sm transition-colors',
                            'hover:bg-background',
                            'focus-visible:outline-none',
                            isNumeric && 'ml-auto',
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortDir === 'asc' ? (
                            <ArrowUp01Icon className="size-icon-xs" />
                          ) : sortDir === 'desc' ? (
                            <ArrowDown01Icon className="size-icon-xs" />
                          ) : (
                            <SortingDownIcon className="size-icon-xs opacity-40" />
                          )}
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
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {columns.map((_col, colIdx) => (
                    <TableCell key={colIdx}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  {empty ?? (
                    <EmptyState
                      title={t('title')}
                      description={t('description')}
                      className="border-0"
                    />
                  )}
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
                      role={onRowClick ? 'button' : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                      onClick={handleRowClick}
                      onKeyDown={handleRowKeyDown}
                      className={cn(
                        onRowClick &&
                          'focus-visible:ring-ring cursor-pointer focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                      )}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const isNumeric = cell.column.columnDef.meta?.numeric === true;
                        const pinning = computePinningProps(cell.column);
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
                        <TableCell colSpan={row.getVisibleCells().length} className="bg-muted p-0">
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
      </div>
      {pagination ? pagination(table) : null}
    </div>
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
 * runtime-dynamic — it depends on the cumulative width of pinned
 * columns earlier in the stack — so it goes via inline style rather
 * than a token. See CLAUDE.md "no one-off magic values" → "the one
 * exception" for why this is the right place for inline style.
 */
function computePinningProps<TData, TValue>(
  column: Column<TData, TValue>,
): {
  'data-pinned-side'?: 'left' | 'right';
  'data-pinned-edge'?: 'last-left' | 'first-right';
  style?: React.CSSProperties;
} {
  const side = column.getIsPinned();
  if (side === false) return {};
  const isLastLeft = side === 'left' && column.getIsLastColumn('left');
  const isFirstRight = side === 'right' && column.getIsFirstColumn('right');
  // runtime-dynamic: sticky offset comes from cumulative widths of
  // earlier pinned columns; can't be tokenized.
  const style: React.CSSProperties =
    side === 'left' ? { left: column.getStart('left') } : { right: column.getAfter('right') };
  return {
    'data-pinned-side': side,
    'data-pinned-edge': isLastLeft ? 'last-left' : isFirstRight ? 'first-right' : undefined,
    style,
  };
}

/**
 * Extend TanStack's ColumnMeta so `meta: { numeric: true }` type-checks
 * and drives right-alignment + tabular-nums styling via data attributes.
 */
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    numeric?: boolean;
  }
}
