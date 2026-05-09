'use client';

import { type ColumnDef } from '@tanstack/react-table';
import {
  Archive01Icon,
  Edit01Icon,
  ArrowReloadVerticalIcon,
  MoreVerticalIcon,
} from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { CostProfile } from '../types/cost-profile.types';

import { CostProfileTypeBadge } from './cost-profile-type-badge';

// ─── Pagination state ────────────────────────────────────────────────────────

interface PaginationState {
  cursor?: string;
  limit: number;
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface CostProfileTableProps {
  data: CostProfile[];
  loading?: boolean;
  empty?: React.ReactNode;
  /** Pagination state for cursor-based nav (the list endpoint uses cursor, not offset). */
  hasMore?: boolean;
  onLoadMore?: () => void;

  // Filter state — URL-driven
  q: string;
  showArchived: boolean;
  typeFilter: string;

  onSearchChange: (next: string) => void;
  onShowArchivedChange: (next: boolean) => void;
  onTypeFilterChange: (next: string) => void;

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
  const formatter = useFormatter();

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
            <div className="flex flex-col gap-0.5">
              <span className="text-foreground font-medium">{profile.name}</span>
              {profile.note !== null && profile.note.length > 0 ? (
                <span className="text-muted-foreground max-w-input-narrow truncate text-xs">
                  {profile.note}
                </span>
              ) : null}
              {profile.archivedAt !== null ? (
                <span className="text-warning text-xs">{t('table.archived')}</span>
              ) : null}
            </div>
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
            return <Currency value={profile.amount} />;
          }
          // Non-TRY: show native + "(currency)" label
          return (
            <span className="tabular-nums">
              {formatter.number(Number.parseFloat(profile.amount), {
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
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatter.relativeTime(new Date(row.original.updatedAt))}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => tCols('actions'),
        cell: ({ row }) => (
          <CostProfileRowActions
            profile={row.original}
            onEditClick={props.onEditClick}
            onArchiveClick={props.onArchiveClick}
            onRestoreClick={props.onRestoreClick}
          />
        ),
      },
    ],
    [formatter, t, tCols, props.onEditClick, props.onArchiveClick, props.onRestoreClick],
  );

  return (
    <DataTable<CostProfile, unknown>
      columns={columns}
      data={props.data}
      loading={props.loading}
      empty={props.empty}
      getRowId={(row) => row.id}
      columnFilters={props.q.length > 0 ? [{ id: 'name', value: props.q }] : []}
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          searchValue={props.q}
          onSearchChange={props.onSearchChange}
          searchPlaceholder={t('table.filters.searchPlaceholder')}
        />
      )}
    />
  );
}

// ─── Row actions dropdown ────────────────────────────────────────────────────

interface CostProfileRowActionsProps {
  profile: CostProfile;
  onEditClick: (profile: CostProfile) => void;
  onArchiveClick: (profile: CostProfile) => void;
  onRestoreClick: (profile: CostProfile) => void;
}

function CostProfileRowActions({
  profile,
  onEditClick,
  onArchiveClick,
  onRestoreClick,
}: CostProfileRowActionsProps): React.ReactElement {
  const t = useTranslations('costs.table.actions');
  const isArchived = profile.archivedAt !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('edit')}>
          <MoreVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onEditClick(profile)}>
          <Edit01Icon className="size-icon-xs" />
          {t('edit')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isArchived ? (
          <DropdownMenuItem onClick={() => onRestoreClick(profile)}>
            <ArrowReloadVerticalIcon className="size-icon-xs" />
            {t('restore')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => onArchiveClick(profile)}
            className="text-warning focus:text-warning"
          >
            <Archive01Icon className="size-icon-xs" />
            {t('archive')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
