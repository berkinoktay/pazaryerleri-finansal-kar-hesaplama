'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { CloudUploadIcon, Delete02Icon, DocumentValidationIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { BulkActionBar } from '@/components/patterns/bulk-action-bar';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import {
  ROW_ACTIONS_COLUMN_ID,
  createRowActionsColumn,
  type RowAction,
} from '@/components/patterns/data-table-row-actions';
import { TableNoResultsState } from '@/components/patterns/data-table-states';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';

import type { FlashProductListRow } from '../lib/flash-product-list';

import { FlashProductExportIndicator } from './flash-product-export-indicator';
import { FlashProductStatusBadge } from './flash-product-status-badge';

export interface FlashProductListTableProps {
  /** Already filtered (search + status) by the parent; the table only paginates/sorts. */
  rows: FlashProductListRow[];
  actions: RowAction<FlashProductListRow>[];
  /** FilterTabs (status) mounted in the table's tab strip. */
  tabsNode: React.ReactNode;
  searchValue: string;
  onSearchChange: (next: string) => void;
  /**
   * Parent-computed "any filter active?" — search/status live OUTSIDE TanStack
   * columnFilters (the parent pre-filters `rows`), so both the no-results body and the
   * toolbar's clear ghost read this server-mode signal instead of a synthetic
   * columnFilters mirror.
   */
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onOpen: (id: string) => void;
  onUpload: () => void;
  onDeleteMany: (ids: string[]) => void;
  /** Forwarded to DataTable: skeleton rows while the list query is in flight. */
  loading?: boolean;
}

/**
 * The saved-uploads table for Flash Products — the full DataTable feature set: a tab strip
 * (status filter), a toolbar (search + column visibility + Clear), sortable columns, row
 * selection with a bulk-delete action bar, and pagination. Search + status filtering are
 * owned by the parent (so the controls stay in sync); this renders the shell and wires
 * selection / bulk delete locally. Like the Advantage table there is no period/validity
 * column — the status column reflects export state only.
 */
export function FlashProductListTable({
  rows,
  actions,
  tabsNode,
  searchValue,
  onSearchChange,
  hasActiveFilters,
  onClearFilters,
  onOpen,
  onUpload,
  onDeleteMany,
  loading = false,
}: FlashProductListTableProps): React.ReactElement {
  const tCols = useTranslations('flashProductsPage.list.columns');
  const tList = useTranslations('flashProductsPage.list');
  const tEmpty = useTranslations('flashProductsPage.list.empty');
  const tBulk = useTranslations('flashProductsPage.list.bulk');

  // Holds the ids to bulk-delete plus a reset bound to the live table instance, so
  // confirming the delete also clears row selection (the raw rowSelection record isn't
  // auto-pruned when the deleted rows leave the data).
  const [bulk, setBulk] = React.useState<{ ids: string[]; resetSelection: () => void } | null>(
    null,
  );

  const columns = React.useMemo<ColumnDef<FlashProductListRow>[]>(
    () => [
      {
        id: 'select',
        enableSorting: false,
        enableHiding: false,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={tList('selectAll')}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={tList('selectRow')}
          />
        ),
      },
      {
        id: 'list',
        header: () => tCols('list'),
        meta: { label: tCols('list') },
        cell: ({ row }) => (
          <div className="gap-sm flex items-center">
            <SoftSquareIcon tone="primary" variant="soft" size="md">
              <DocumentValidationIcon />
            </SoftSquareIcon>
            <div className="min-w-0">
              <div className="text-foreground truncate text-sm font-semibold">
                {row.original.name}
              </div>
            </div>
          </div>
        ),
      },
      {
        // accessorFn unlocks getCanSort(); the custom cell still renders the figure + unit.
        // Distinct products in the upload.
        id: 'products',
        accessorFn: (row) => row.productCount,
        header: () => tCols('products'),
        meta: { numeric: true, label: tCols('products') },
        cell: ({ row }) => (
          <span className="tabular-nums">
            <span className="text-foreground font-semibold">{row.original.productCount}</span>{' '}
            <span className="text-muted-foreground text-2xs">{tList('productUnit')}</span>
          </span>
        ),
      },
      {
        // Offer-row participation (chosen / total) — the seller's core "how far am I" signal.
        id: 'offers',
        accessorFn: (row) => row.itemCount,
        header: () => tCols('offers'),
        meta: { numeric: true, label: tCols('offers') },
        cell: ({ row }) => (
          <span className="tabular-nums">
            <span className="text-foreground font-semibold">{row.original.selectedCount}</span>
            <span className="text-muted-foreground">/{row.original.itemCount}</span>{' '}
            <span className="text-muted-foreground text-2xs">{tList('offerUnit')}</span>
          </span>
        ),
      },
      {
        id: 'status',
        accessorFn: (row) => (row.exported ? 1 : 0),
        header: () => tCols('status'),
        meta: { label: tCols('status') },
        cell: ({ row }) => <FlashProductStatusBadge exported={row.original.exported} />,
      },
      {
        id: 'exported',
        accessorFn: (row) => (row.exported ? 1 : 0),
        header: () => tCols('exported'),
        meta: { label: tCols('exported') },
        cell: ({ row }) => <FlashProductExportIndicator exported={row.original.exported} />,
      },
      createRowActionsColumn<FlashProductListRow>(actions),
    ],
    [tCols, tList, actions],
  );

  return (
    <>
      <DataTable<FlashProductListRow, unknown>
        columns={columns}
        data={rows}
        loading={loading}
        getRowId={(row) => row.id}
        enableRowSelection
        onRowClick={(row) => onOpen(row.id)}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={onClearFilters}
        initialColumnPinning={{ right: [ROW_ACTIONS_COLUMN_ID] }}
        tabs={tabsNode}
        toolbar={(table) => (
          <DataTableToolbar
            table={table}
            searchValue={searchValue}
            onSearchChange={onSearchChange}
            searchPlaceholder={tList('search')}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={onClearFilters}
          />
        )}
        pagination={(table) => <DataTablePagination table={table} />}
        fab={(table) => {
          const selected = table.getSelectedRowModel().rows;
          return (
            <BulkActionBar
              selectedCount={selected.length}
              onClear={() => table.resetRowSelection()}
              countLabel={(count) => tBulk('selected', { count })}
              actions={[
                {
                  id: 'delete',
                  label: tBulk('delete'),
                  icon: <Delete02Icon />,
                  tone: 'destructive',
                  onClick: () =>
                    setBulk({
                      ids: selected.map((row) => row.original.id),
                      resetSelection: () => table.resetRowSelection(),
                    }),
                },
              ]}
            />
          );
        }}
        noResultsState={<TableNoResultsState onClearFilters={onClearFilters} />}
        empty={
          <EmptyState
            embedded
            icon={DocumentValidationIcon}
            title={tEmpty('title')}
            description={tEmpty('description')}
            action={
              <Button leadingIcon={<CloudUploadIcon aria-hidden />} onClick={onUpload}>
                {tEmpty('cta')}
              </Button>
            }
          />
        }
      />

      <ConfirmDialog
        open={bulk !== null}
        onOpenChange={(open) => {
          if (!open) setBulk(null);
        }}
        title={tBulk('deleteTitle')}
        description={tBulk('deleteDescription', { count: bulk?.ids.length ?? 0 })}
        confirmLabel={tBulk('deleteConfirm')}
        onConfirm={() => {
          if (bulk !== null) {
            onDeleteMany(bulk.ids);
            bulk.resetSelection();
          }
          setBulk(null);
        }}
      />
    </>
  );
}
