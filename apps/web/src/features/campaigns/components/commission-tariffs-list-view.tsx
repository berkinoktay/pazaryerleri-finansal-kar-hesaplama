'use client';

import { type ColumnFiltersState } from '@tanstack/react-table';
import { CloudUploadIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { FilterTabs } from '@/components/patterns/filter-tabs';
import { PageHeader } from '@/components/patterns/page-header';
import { Button } from '@/components/ui/button';

import type { CommissionTariffListItem } from '../api/list-tariffs.api';
import {
  matchesTariffQuery,
  summarizeTariffList,
  toListRows,
  type TariffListRow,
} from '../lib/commission-tariff-list';
import type { TariffValidity } from '../types';

import { CommissionTariffListSummary } from './commission-tariff-list-summary';
import { CommissionTariffListTable } from './commission-tariff-list-table';
import { useTariffRowActions } from './use-tariff-row-actions';

type StatusFilter = 'all' | TariffValidity | 'draft';

export interface CommissionTariffsListViewProps {
  items: readonly CommissionTariffListItem[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * The route-open LIST screen for Product Commission Tariffs. Always renders the
 * full shell — header + actions, summary strip, then one data panel with a
 * status tab strip, a search + column-visibility toolbar, sortable columns,
 * row selection + bulk delete, and pagination. The "no tariffs yet" case lives
 * as an empty state INSIDE the panel so the page never collapses to an empty
 * page. Search + status filtering are owned here so every control stays in sync.
 */
export function CommissionTariffsListView({
  items,
  onOpen,
  onCreate,
  onExport,
  onDelete,
}: CommissionTariffsListViewProps): React.ReactElement {
  const t = useTranslations('campaignsPages.productCommissionTariffs');
  const tList = useTranslations('commissionTariffsPage.list');
  const tTemplates = useTranslations('commissionTariffsPage.templates');
  const tFilters = useTranslations('commissionTariffsPage.filters');
  const tStatus = useTranslations('commissionTariffsPage.listStatus');

  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');
  const [deleteTarget, setDeleteTarget] = React.useState<TariffListRow | null>(null);

  const rows = React.useMemo(() => toListRows(items), [items]);
  const queryFiltered = React.useMemo(
    () => rows.filter((row) => matchesTariffQuery(row, query)),
    [rows, query],
  );
  const matchesStatus = React.useCallback(
    (row: TariffListRow): boolean =>
      statusFilter === 'all' ||
      (statusFilter === 'draft' ? row.validity === null : row.validity === statusFilter),
    [statusFilter],
  );
  const filtered = React.useMemo(
    () => queryFiltered.filter(matchesStatus),
    [queryFiltered, matchesStatus],
  );

  // Per-status counts over the search-filtered set, so the tabs reflect the search.
  const statusCounts = React.useMemo(() => {
    const counts = { all: queryFiltered.length, active: 0, upcoming: 0, past: 0, draft: 0 };
    for (const row of queryFiltered) {
      if (row.validity === null) counts.draft += 1;
      else counts[row.validity] += 1;
    }
    return counts;
  }, [queryFiltered]);

  // Mirror the active filters as column filters so the table's isFiltered /
  // no-results / Clear logic lights up (the data itself is filtered here).
  const columnFilters = React.useMemo<ColumnFiltersState>(() => {
    const next: ColumnFiltersState = [];
    if (query.trim() !== '') next.push({ id: 'tariff', value: query });
    if (statusFilter !== 'all') next.push({ id: 'status', value: statusFilter });
    return next;
  }, [query, statusFilter]);

  const stats = React.useMemo(() => summarizeTariffList(rows), [rows]);

  const requestDelete = React.useCallback((row: TariffListRow) => setDeleteTarget(row), []);
  const actions = useTariffRowActions({ onOpen, onExport, onRequestDelete: requestDelete });

  const clearFilters = React.useCallback(() => {
    setQuery('');
    setStatusFilter('all');
  }, []);
  const deleteMany = React.useCallback(
    (ids: string[]) => ids.forEach((id) => onDelete(id)),
    [onDelete],
  );

  // The data panel's top row: status tabs on the left, the page's primary
  // actions on the right — so "Upload Excel" sits next to the data it feeds,
  // not isolated in the page's far corner.
  const tabsRow = (
    <div className="gap-sm flex flex-wrap items-center justify-between">
      <FilterTabs
        value={statusFilter}
        onValueChange={setStatusFilter}
        aria-label={tList('filterLabel')}
        options={[
          { value: 'all', label: tFilters('all'), count: statusCounts.all },
          { value: 'active', label: tStatus('active'), count: statusCounts.active },
          { value: 'upcoming', label: tStatus('upcoming'), count: statusCounts.upcoming },
          { value: 'past', label: tStatus('past'), count: statusCounts.past },
          { value: 'draft', label: tStatus('draft'), count: statusCounts.draft },
        ]}
      />
      <Button size="sm" leadingIcon={<CloudUploadIcon aria-hidden />} onClick={onCreate}>
        {tList('upload')}
      </Button>
    </div>
  );

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader
        title={t('title')}
        intent={t('intent')}
        // `gap-lg` so the title/intent breathe above the summary strip (the
        // default gap-sm read as cramped); no bottom rule so the strip flows
        // into the data panel below rather than being fenced off by a separator.
        className="gap-lg border-b-0 pb-0"
        summary={<CommissionTariffListSummary stats={stats} />}
      />

      <CommissionTariffListTable
        rows={filtered}
        actions={actions}
        tabsNode={tabsRow}
        searchValue={query}
        onSearchChange={setQuery}
        columnFilters={columnFilters}
        onClearFilters={clearFilters}
        onOpen={onOpen}
        onUpload={onCreate}
        onDeleteMany={deleteMany}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={tTemplates('deleteTitle')}
        description={tTemplates('deleteDescription')}
        confirmLabel={tTemplates('deleteConfirm')}
        onConfirm={() => {
          if (deleteTarget !== null) onDelete(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
