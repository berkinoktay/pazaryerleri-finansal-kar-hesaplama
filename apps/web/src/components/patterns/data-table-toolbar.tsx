'use client';

import { type Table } from '@tanstack/react-table';
import {
  Cancel01Icon,
  DownloadSquare02Icon,
  FilterIcon,
  Search01Icon,
  SidebarLeftIcon,
  SidebarRightIcon,
  UploadSquare02Icon,
  ViewIcon,
} from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  /** Column id to filter via the search input. */
  searchColumn?: string;
  /**
   * Controlled-search alternative to `searchColumn`. Bind the search
   * input to a page-level value/onChange pair instead of a TanStack
   * column filter. Use for server-paginated pages where search is a
   * query param, not a column filter.
   *
   * Mutually exclusive with `searchColumn` — pass exactly one. If both
   * are supplied, `searchColumn` wins (development-mode warning).
   */
  searchValue?: string;
  onSearchChange?: (next: string) => void;
  /** Override the localized default placeholder if a feature needs custom copy. */
  searchPlaceholder?: string;
  /** Handler invoked when the user clicks the import button. */
  onImport?: () => void;
  /** Handler invoked when the user clicks the export button. */
  onExport?: (rows: TData[]) => void;
  /** Slot for faceted filter popovers (multi-select chips). */
  facets?: React.ReactNode;
}

/**
 * Standard toolbar mounted above a DataTable: search, faceted filters,
 * column visibility, and import/export controls. Emits handlers rather
 * than implementing CSV/XLSX serialization here — each feature page
 * decides what shape to serialize (order lines vs flat rows). All copy
 * (search placeholder, clear / import / export labels, column-visibility
 * menu) reads from `t('common.dataTable.toolbar.*')`.
 *
 * @useWhen mounting the standard toolbar above a DataTable for search, faceted filters, column visibility, and import/export
 */
export function DataTableToolbar<TData>({
  table,
  searchColumn,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  onImport,
  onExport,
  facets,
}: DataTableToolbarProps<TData>): React.ReactElement {
  const t = useTranslations('common.dataTable.toolbar');
  const isFiltered = table.getState().columnFilters.length > 0;

  const isColumnSearch = searchColumn !== undefined;
  const isControlledSearch =
    !isColumnSearch && searchValue !== undefined && onSearchChange !== undefined;

  // Dev-mode warning if both search modes are supplied — searchColumn wins
  // for backwards compatibility, onSearchChange will not fire.
  if (process.env['NODE_ENV'] !== 'production' && isColumnSearch && searchValue !== undefined) {
    console.warn(
      '[DataTableToolbar] both `searchColumn` and `searchValue` were supplied. ' +
        'searchColumn wins; onSearchChange will not fire.',
    );
  }

  const inputValue = isColumnSearch
    ? ((table.getColumn(searchColumn)?.getFilterValue() as string | undefined) ?? '')
    : (searchValue ?? '');

  const handleSearchInput = (next: string): void => {
    if (isColumnSearch) {
      table.getColumn(searchColumn)?.setFilterValue(next);
    } else if (isControlledSearch) {
      onSearchChange(next);
    }
  };

  return (
    <div className="gap-sm flex flex-wrap items-center justify-between">
      <div className="gap-xs flex flex-1 flex-wrap items-center">
        {isColumnSearch || isControlledSearch ? (
          <div className="max-w-input relative flex-1">
            <Search01Icon className="left-sm size-icon-sm text-muted-foreground pointer-events-none absolute top-1/2 -translate-y-1/2" />
            <Input
              value={inputValue}
              onChange={(event) => handleSearchInput(event.target.value)}
              placeholder={searchPlaceholder ?? t('searchPlaceholder')}
              className="pl-2xl"
            />
          </div>
        ) : null}
        {facets}
        {isFiltered ? (
          <Button variant="ghost" size="sm" onClick={() => table.resetColumnFilters()}>
            {t('clear')}
            <Cancel01Icon className="ml-3xs size-icon-xs" />
          </Button>
        ) : null}
      </div>
      <div className="gap-xs flex items-center">
        {onImport ? (
          <Button variant="outline" size="sm" onClick={onImport}>
            <UploadSquare02Icon className="size-icon-sm" />
            {t('import')}
          </Button>
        ) : null}
        {onExport ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onExport(table.getFilteredRowModel().rows.map((row) => row.original))}
          >
            <DownloadSquare02Icon className="size-icon-sm" />
            {t('export')}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label={t('toggleColumns')}>
              <ViewIcon className="size-icon-sm" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('visibleColumns')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide() || column.getCanPin())
              .map((column) => {
                const pinned = column.getIsPinned();
                const canHide = column.getCanHide();
                const canPin = column.getCanPin();
                return (
                  <DropdownMenuItem
                    key={column.id}
                    // Keep the dropdown open when the user toggles visibility
                    // or pinning — they often want to flip several at once.
                    onSelect={(event) => event.preventDefault()}
                    className="gap-sm"
                  >
                    <label className="gap-2xs flex flex-1 cursor-pointer items-center">
                      <Checkbox
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) => column.toggleVisibility(!!value)}
                        disabled={!canHide}
                        aria-label={column.id}
                      />
                      <span className="truncate text-sm">{column.id}</span>
                    </label>
                    {canPin ? (
                      <div className="gap-3xs flex items-center">
                        <button
                          type="button"
                          aria-label={t('pinLeft')}
                          aria-pressed={pinned === 'left'}
                          onClick={() => column.pin(pinned === 'left' ? false : 'left')}
                          className={cn(
                            'p-3xs duration-fast inline-flex items-center justify-center rounded-sm transition-colors',
                            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                            pinned === 'left'
                              ? 'bg-muted text-foreground'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          )}
                        >
                          <SidebarLeftIcon className="size-icon-xs" />
                        </button>
                        <button
                          type="button"
                          aria-label={t('pinRight')}
                          aria-pressed={pinned === 'right'}
                          onClick={() => column.pin(pinned === 'right' ? false : 'right')}
                          className={cn(
                            'p-3xs duration-fast inline-flex items-center justify-center rounded-sm transition-colors',
                            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                            pinned === 'right'
                              ? 'bg-muted text-foreground'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          )}
                        >
                          <SidebarRightIcon className="size-icon-xs" />
                        </button>
                      </div>
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export { FilterIcon };
