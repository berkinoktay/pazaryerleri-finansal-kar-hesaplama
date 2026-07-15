'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { CloudUploadIcon, Delete02Icon, DiscountIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
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

import { useDescribeDiscountConfig } from '../lib/discount-config';
import type { DiscountListRow } from '../lib/discount-list';

import { DiscountListStatusBadge } from './discount-list-status-badge';
import { DiscountTypeBadge } from './discount-type-badge';

export interface DiscountListTableProps {
  /** Already filtered (search + status) by the parent; the table only paginates/sorts. */
  rows: DiscountListRow[];
  actions: RowAction<DiscountListRow>[];
  /** FilterTabs (status) mounted in the table's tab strip. */
  tabsNode: React.ReactNode;
  searchValue: string;
  onSearchChange: (next: string) => void;
  /**
   * Parent-computed "any filter active?" — search/status live OUTSIDE TanStack columnFilters
   * (the parent pre-filters `rows`), so both the no-results body and the toolbar's clear ghost
   * read this server-mode signal instead of a synthetic columnFilters mirror.
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
 * The saved-uploads table for İndirimler — the full DataTable feature set: a tab strip
 * (status filter), a toolbar (search + column visibility + Clear), sortable columns, row
 * selection with a bulk-delete action bar, and pagination. Search + status filtering are owned
 * by the parent (so the controls stay in sync); this renders the shell and wires selection /
 * bulk delete locally. Unlike Flash the row carries the discount CONFIG, so the name cell shows
 * a one-line config summary and a dedicated type column renders the kurgu badge.
 */
export function DiscountListTable({
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
}: DiscountListTableProps): React.ReactElement {
  const tCols = useTranslations('discountsPage.list.columns');
  const tList = useTranslations('discountsPage.list');
  const tEmpty = useTranslations('discountsPage.list.empty');
  const tBulk = useTranslations('discountsPage.list.bulk');
  const format = useFormatter();
  const describeConfig = useDescribeDiscountConfig();

  // Holds the ids to bulk-delete plus a reset bound to the live table instance, so confirming
  // the delete also clears row selection (the raw rowSelection record isn't auto-pruned when
  // the deleted rows leave the data).
  const [bulk, setBulk] = React.useState<{ ids: string[]; resetSelection: () => void } | null>(
    null,
  );

  const columns = React.useMemo<ColumnDef<DiscountListRow>[]>(
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
        id: 'name',
        header: () => tCols('name'),
        meta: { label: tCols('name') },
        cell: ({ row }) => (
          <div className="gap-sm flex items-center">
            <SoftSquareIcon tone="primary" variant="soft" size="md">
              <DiscountIcon />
            </SoftSquareIcon>
            <div className="min-w-0">
              <div className="text-foreground truncate text-sm font-semibold">
                {row.original.name}
              </div>
              <div className="text-muted-foreground text-2xs truncate">
                {describeConfig(row.original)}
              </div>
            </div>
          </div>
        ),
      },
      {
        // accessorFn unlocks getCanSort(); the custom cell renders the type badge.
        id: 'type',
        accessorFn: (row) => row.discountType,
        header: () => tCols('type'),
        meta: { label: tCols('type') },
        cell: ({ row }) => <DiscountTypeBadge type={row.original.discountType} />,
      },
      {
        // Product-selection rows in the upload.
        id: 'products',
        accessorFn: (row) => row.itemCount,
        header: () => tCols('products'),
        meta: { numeric: true, label: tCols('products') },
        cell: ({ row }) => (
          <span className="text-foreground font-semibold tabular-nums">
            {row.original.itemCount}
          </span>
        ),
      },
      {
        // Included / total — the seller's core "how far am I" signal.
        id: 'selected',
        accessorFn: (row) => row.selectedCount,
        header: () => tCols('selected'),
        meta: { numeric: true, label: tCols('selected') },
        cell: ({ row }) => (
          <span className="tabular-nums">
            <span className="text-foreground font-semibold">{row.original.selectedCount}</span>
            <span className="text-muted-foreground">/{row.original.itemCount}</span>
          </span>
        ),
      },
      {
        id: 'updated',
        accessorFn: (row) => row.updatedAt,
        header: () => tCols('updated'),
        meta: { label: tCols('updated') },
        cell: ({ row }) => (
          <span className="text-muted-foreground text-2xs whitespace-nowrap tabular-nums">
            {format.dateTime(new Date(row.original.updatedAt), 'short')}
          </span>
        ),
      },
      {
        id: 'status',
        accessorFn: (row) => (row.exported ? 1 : 0),
        header: () => tCols('status'),
        meta: { label: tCols('status') },
        cell: ({ row }) => <DiscountListStatusBadge exported={row.original.exported} />,
      },
      createRowActionsColumn<DiscountListRow>(actions),
    ],
    [tCols, tList, format, describeConfig, actions],
  );

  return (
    <>
      <DataTable<DiscountListRow, unknown>
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
            icon={DiscountIcon}
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
