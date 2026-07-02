'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { Archive01Icon, ArrowReloadVerticalIcon, Edit01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { createRowActionsColumn } from '@/components/patterns/data-table-row-actions';
import { TableNoResultsState } from '@/components/patterns/data-table-states';
import {
  DataTableToolbar,
  type DataTableToolbarAdvancedFilter,
} from '@/components/patterns/data-table-toolbar';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { useIsMounted } from '@/lib/use-is-mounted';

import type { CostProfile } from '../types/cost-profile.types';

import { CostProfileTypeBadge } from './cost-profile-type-badge';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface CostProfileTableProps {
  data: CostProfile[];
  loading?: boolean;
  empty?: React.ReactNode;
  /** Cursor pagination: renders the load-more footer while more pages exist. */
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;

  // Filter state — client search + the advanced-filter chip config
  // (type single-select + archived flag). The parent PRE-FILTERS `data` by
  // the search text (client-side, campaigns-list pattern) and owns the
  // combined active-filter signal + full clear.
  q: string;
  onSearchChange: (next: string) => void;
  advancedFilter: DataTableToolbarAdvancedFilter;
  hasActiveFilters: boolean;
  onClearFilters: () => void;

  // Row actions
  onEditClick: (profile: CostProfile) => void;
  onArchiveClick: (profile: CostProfile) => void;
  onRestoreClick: (profile: CostProfile) => void;
}

/**
 * Cost profiles table built on the shared DataTable pattern with TanStack v8.
 *
 * Client-filtered: the list is org-scoped and typically small (<200 rows) so
 * client-side search (column filter) is used rather than server-round-trip.
 * Archive/type filters remain server-driven query params.
 */
export function CostProfileTable(props: CostProfileTableProps): React.ReactElement {
  const t = useTranslations('costs');
  const tCols = useTranslations('costs.table.columns');
  const tActions = useTranslations('costs.table.actions');
  const formatter = useFormatter();
  // Gate relativeTime() on mount: SSR has no stable "now", so server/client
  // would render different relative labels and trip a hydration mismatch.
  // Before mount we render the deterministic absolute date; after mount we
  // swap in the friendlier relative form. Pattern from apps/web/CLAUDE.md
  // (SSR safety §2).
  const mounted = useIsMounted();

  const columns = React.useMemo<ColumnDef<CostProfile>[]>(
    () => [
      {
        id: 'type',
        header: () => tCols('type'),
        cell: ({ row }) => <CostProfileTypeBadge type={row.original.type} />,
      },
      {
        id: 'name',
        accessorKey: 'name',
        header: () => tCols('name'),
        enableColumnFilter: true,
        cell: ({ row }) => {
          const profile = row.original;
          return (
            <Link
              href={`/costs/${profile.id}`}
              className="hover:text-primary group flex flex-col gap-0.5 transition-colors outline-none focus-visible:underline"
            >
              <span className="text-foreground group-hover:text-primary font-medium underline-offset-2 group-hover:underline">
                {profile.name}
              </span>
              {profile.note !== null && profile.note.length > 0 ? (
                <span className="text-muted-foreground max-w-input-narrow truncate text-xs">
                  {profile.note}
                </span>
              ) : null}
              {profile.archivedAt !== null ? (
                <span className="text-warning text-xs">{t('table.archived')}</span>
              ) : null}
            </Link>
          );
        },
      },
      {
        id: 'amount',
        header: () => tCols('amount'),
        meta: { numeric: true },
        cell: ({ row }) => {
          const profile = row.original;
          if (profile.currency === 'TRY') {
            return <Currency value={profile.amountGross} />;
          }
          // Non-TRY: show native + "(currency)" label
          return (
            <span className="tabular-nums">
              {formatter.number(Number.parseFloat(profile.amountGross), {
                maximumFractionDigits: 2,
                minimumFractionDigits: 2,
              })}
              &nbsp;
              <span className="text-muted-foreground text-xs">{profile.currency}</span>
            </span>
          );
        },
      },
      {
        id: 'vatRate',
        header: () => tCols('vatRate'),
        meta: { numeric: true },
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm tabular-nums">
            %{row.original.vatRate}
          </span>
        ),
      },
      {
        id: 'updatedAt',
        header: () => tCols('lastUpdated'),
        cell: ({ row }) => {
          const updatedAt = new Date(row.original.updatedAt);
          return (
            <span className="text-muted-foreground text-sm">
              {mounted
                ? formatter.relativeTime(updatedAt, new Date())
                : formatter.dateTime(updatedAt, 'short')}
            </span>
          );
        },
      },
      createRowActionsColumn<CostProfile>((profile) =>
        profile.archivedAt !== null
          ? [
              { label: tActions('edit'), icon: <Edit01Icon />, onSelect: props.onEditClick },
              {
                label: tActions('restore'),
                icon: <ArrowReloadVerticalIcon />,
                onSelect: props.onRestoreClick,
                separatorBefore: true,
              },
            ]
          : [
              { label: tActions('edit'), icon: <Edit01Icon />, onSelect: props.onEditClick },
              {
                label: tActions('archive'),
                icon: <Archive01Icon />,
                onSelect: props.onArchiveClick,
                tone: 'warning',
                separatorBefore: true,
              },
            ],
      ),
    ],
    [
      formatter,
      t,
      tCols,
      tActions,
      mounted,
      props.onEditClick,
      props.onArchiveClick,
      props.onRestoreClick,
    ],
  );

  return (
    <DataTable<CostProfile, unknown>
      columns={columns}
      data={props.data}
      loading={props.loading}
      empty={props.empty}
      // hasActiveFilters covers BOTH the client search and the server-side
      // type/archived chips (invisible to columnFilters) — a filtered-to-zero
      // view must resolve to the no-results state, never the first-run
      // "create your first profile" CTA. The explicit noResultsState is
      // REQUIRED here: the body ladder is `noResultsState ?? empty ?? default`,
      // so with only `empty` set the create-CTA would win over no-results.
      hasActiveFilters={props.hasActiveFilters}
      onClearFilters={props.onClearFilters}
      noResultsState={<TableNoResultsState onClearFilters={props.onClearFilters} />}
      getRowId={(row) => row.id}
      // Controlled pagination with a page as large as the loaded set: flips
      // TanStack to manualPagination so it renders EVERY row the cursor pages
      // have accumulated. Uncontrolled mode silently sliced to its internal
      // pageSize of 10 — even the first server page (25) was cut short.
      paginationState={{ pageIndex: 0, pageSize: Math.max(props.data.length, 1) }}
      onPaginationChange={() => undefined}
      pageCount={1}
      rowCount={props.data.length}
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          searchValue={props.q}
          onSearchChange={props.onSearchChange}
          searchPlaceholder={t('table.filters.searchPlaceholder')}
          advancedFilter={props.advancedFilter}
        />
      )}
      // Cursor-based load-more footer. Consuming hasMore/onLoadMore here fixes
      // the unreachable-second-page bug: the props existed but nothing rendered
      // them, so profiles beyond the first cursor page could never be shown.
      pagination={
        props.hasMore === true
          ? () => (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={props.onLoadMore}
                  disabled={props.loadingMore === true}
                >
                  {t('table.loadMore')}
                </Button>
              </div>
            )
          : undefined
      }
    />
  );
}
