'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { MoreVerticalIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** Canonical column id for the row-actions column. */
export const ROW_ACTIONS_COLUMN_ID = 'actions';

export interface RowAction<TData> {
  /** Localized item label (Turkish via the feature's i18n). */
  label: string;
  /** Optional leading icon — auto-sized to `size-icon-sm`. */
  icon?: React.ReactNode;
  /** Fired when the item is chosen. */
  onSelect: (row: TData) => void;
  /**
   * `destructive` tints the item red (delete / remove); `warning` tints it
   * amber for reversible caution actions (archive / suspend). Default is neutral.
   */
  tone?: 'default' | 'destructive' | 'warning';
  /** Per-row disabled predicate (e.g. hide delete on a locked row). */
  disabled?: (row: TData) => boolean;
  /** Inserts a separator above this item to mark a group boundary. */
  separatorBefore?: boolean;
}

export interface DataTableRowActionsProps<TData> {
  /** The row's data. */
  row: TData;
  /** Actions, or a function returning per-row actions. Empty → renders nothing. */
  actions: RowAction<TData>[] | ((row: TData) => RowAction<TData>[]);
  /** Override the kebab trigger's accessible label (defaults to a localized one). */
  triggerLabel?: string;
}

/**
 * Always-visible right-aligned kebab that opens a row's overflow action menu.
 * Composed from `ui/` primitives (ghost icon Button + DropdownMenu) — the
 * trigger is a real `<button>`, so DataTable's `onRowClick` guard never
 * double-fires when the kebab is clicked.
 *
 * Use `createRowActionsColumn` for the standard column wiring; reach for this
 * component directly only when a feature needs a bespoke action column.
 *
 * @useWhen giving each DataTable row an overflow (kebab) action menu
 */
export function DataTableRowActions<TData>({
  row,
  actions,
  triggerLabel,
}: DataTableRowActionsProps<TData>): React.ReactElement | null {
  const t = useTranslations('common.dataTable.rowActions');
  const items = typeof actions === 'function' ? actions(row) : actions;
  if (items.length === 0) return null;

  return (
    // -mr-2xs pulls the kebab toward the row's right edge so it sits flush in a
    // (typically right-pinned) narrow actions column.
    <div className="-mr-2xs flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={triggerLabel ?? t('trigger')}>
            <MoreVerticalIcon className="size-icon-sm" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map((action, index) => (
            <React.Fragment key={index}>
              {action.separatorBefore ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                disabled={action.disabled?.(row) ?? false}
                onSelect={() => action.onSelect(row)}
                className={cn(
                  '[&_svg]:size-icon-sm',
                  action.tone === 'destructive' &&
                    'text-destructive data-[highlighted]:bg-destructive-surface data-[highlighted]:text-destructive',
                  action.tone === 'warning' &&
                    'text-warning data-[highlighted]:bg-warning-surface data-[highlighted]:text-warning',
                )}
              >
                {action.icon}
                {action.label}
              </DropdownMenuItem>
            </React.Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function RowActionsColumnHeader(): React.ReactElement {
  const t = useTranslations('common.dataTable.rowActions');
  // Hidden header: the column carries an accessible name without adding visible
  // chrome to the header band.
  return <span className="sr-only">{t('columnHeader')}</span>;
}

/**
 * Builds the standard right-aligned, always-visible row-actions column for a
 * DataTable: a kebab menu per row, a hidden (sr-only) header, sorting + hiding
 * disabled, and the canonical `actions` id. Pin it right via
 * `initialColumnPinning={{ right: [ROW_ACTIONS_COLUMN_ID] }}` so it stays
 * reachable during horizontal scroll.
 */
export function createRowActionsColumn<TData>(
  actions: RowAction<TData>[] | ((row: TData) => RowAction<TData>[]),
  options?: { id?: string; triggerLabel?: string },
): ColumnDef<TData> {
  return {
    id: options?.id ?? ROW_ACTIONS_COLUMN_ID,
    enableSorting: false,
    enableHiding: false,
    header: () => <RowActionsColumnHeader />,
    cell: ({ row }) => (
      <DataTableRowActions
        row={row.original}
        actions={actions}
        triggerLabel={options?.triggerLabel}
      />
    ),
  };
}
