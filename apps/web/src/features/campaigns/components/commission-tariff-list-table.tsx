'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { CloudUploadIcon, Delete02Icon, DocumentValidationIcon } from 'hugeicons-react';
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

import type { TariffListRow } from '../lib/commission-tariff-list';
import type { TariffValidity } from '../types';

import { CommissionTariffExportIndicator } from './commission-tariff-export-indicator';
import { CommissionTariffStatusBadge } from './commission-tariff-status-badge';

const DASH = '—';

/** Sort weight so the Status column orders active → upcoming → past → draft. */
const STATUS_SORT_WEIGHT: Record<TariffValidity, number> = {
  active: 0,
  upcoming: 1,
  past: 2,
};

const sortWeightForValidity = (validity: TariffValidity | null): number =>
  validity === null ? 3 : STATUS_SORT_WEIGHT[validity];

export interface CommissionTariffListTableProps {
  /** Already filtered (search + status) by the parent; the table only paginates/sorts. */
  rows: TariffListRow[];
  actions: RowAction<TariffListRow>[];
  /** FilterTabs (status) mounted in the table's tab strip. */
  tabsNode: React.ReactNode;
  searchValue: string;
  onSearchChange: (next: string) => void;
  /**
   * Parent-computed "any filter active?" — search/status live OUTSIDE
   * TanStack columnFilters (the parent pre-filters `rows`), so both the
   * no-results body and the toolbar's clear ghost read this server-mode
   * signal instead of a synthetic columnFilters mirror.
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
 * The saved-tariffs table — the full DataTable feature set: a tab strip (status
 * filter), a toolbar (search + column visibility + Clear), sortable columns,
 * row selection with a bulk-delete action bar, and pagination. Search + status
 * filtering are owned by the parent (so the controls stay in sync); this
 * component renders the shell and wires selection / bulk delete locally.
 */
export function CommissionTariffListTable({
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
}: CommissionTariffListTableProps): React.ReactElement {
  const tCols = useTranslations('commissionTariffsPage.list.columns');
  const tList = useTranslations('commissionTariffsPage.list');
  const tEmpty = useTranslations('commissionTariffsPage.list.empty');
  const tBulk = useTranslations('commissionTariffsPage.list.bulk');
  const format = useFormatter();

  // The tariff's WEEK WINDOW, in a compact numeric form (`23.06.2026 –
  // 30.06.2026`) so the range fits a table cell — the picker/detail/summary
  // keep the long "30 Temmuz 2026 08:00" stamp. Draft tariffs (no dates) read
  // an em-dash; the status column already flags them as "Taslak".
  const formatWeekRange = React.useCallback(
    (row: TariffListRow): string => {
      if (row.weekStartsAt === null || row.weekEndsAt === null) return DASH;
      const start = format.dateTime(new Date(row.weekStartsAt), 'date');
      const end = format.dateTime(new Date(row.weekEndsAt), 'date');
      return `${start} – ${end}`;
    },
    [format],
  );

  // Holds the ids to bulk-delete plus a reset bound to the live table instance,
  // so confirming the delete also clears row selection (the raw rowSelection
  // record isn't auto-pruned when the deleted rows leave the data).
  const [bulk, setBulk] = React.useState<{ ids: string[]; resetSelection: () => void } | null>(
    null,
  );

  const columns = React.useMemo<ColumnDef<TariffListRow>[]>(
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
        id: 'tariff',
        header: () => tCols('tariff'),
        meta: { label: tCols('tariff') },
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
        // The week window the tariff covers. accessorFn (week-start epoch, 0 for
        // draft) unlocks sorting and column visibility; the cell renders the
        // compact date range.
        id: 'period',
        accessorFn: (row) => (row.weekStartsAt !== null ? new Date(row.weekStartsAt).getTime() : 0),
        header: () => tCols('period'),
        meta: { label: tCols('period') },
        cell: ({ row }) => (
          <span className="text-foreground text-sm whitespace-nowrap tabular-nums">
            {formatWeekRange(row.original)}
          </span>
        ),
      },
      {
        // accessorFn unlocks getCanSort() (a display column can't sort); the
        // custom cell still renders the figure + unit. Shows selection progress
        // (chosen / total) — the seller's core "how far am I" signal.
        id: 'products',
        accessorFn: (row) => row.productCount,
        header: () => tCols('products'),
        meta: { numeric: true, label: tCols('products') },
        cell: ({ row }) => (
          <span className="tabular-nums">
            <span className="text-foreground font-semibold">{row.original.selectedCount}</span>
            <span className="text-muted-foreground">/{row.original.productCount}</span>{' '}
            <span className="text-muted-foreground text-2xs">{tList('productUnit')}</span>
          </span>
        ),
      },
      {
        id: 'status',
        accessorFn: (row) => sortWeightForValidity(row.validity),
        header: () => tCols('status'),
        meta: { label: tCols('status') },
        cell: ({ row }) => <CommissionTariffStatusBadge validity={row.original.validity} />,
      },
      {
        id: 'exported',
        accessorFn: (row) => (row.exported ? 1 : 0),
        header: () => tCols('exported'),
        meta: { label: tCols('exported') },
        cell: ({ row }) => <CommissionTariffExportIndicator exported={row.original.exported} />,
      },
      createRowActionsColumn<TariffListRow>(actions),
    ],
    [tCols, tList, actions, formatWeekRange],
  );

  return (
    <>
      <DataTable<TariffListRow, unknown>
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
