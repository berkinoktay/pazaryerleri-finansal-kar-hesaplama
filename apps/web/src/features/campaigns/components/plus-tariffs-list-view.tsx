'use client';

import { CloudUploadIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import { parseAsString, parseAsStringEnum, useQueryStates } from 'nuqs';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { FilterTabs } from '@/components/patterns/filter-tabs';
import { PageHeader } from '@/components/patterns/page-header';
import { TrendyolPlusLockup } from '@/components/patterns/trendyol-plus-lockup';
import { Button } from '@/components/ui/button';

import type { PlusTariffListItem } from '../api/list-plus-tariffs.api';
import {
  matchesPlusTariffQuery,
  summarizePlusTariffList,
  toListRows,
  type PlusTariffListRow,
} from '../lib/plus-tariff-list';

import { PlusTariffListSummary } from './plus-tariff-list-summary';
import { PlusTariffListTable } from './plus-tariff-list-table';
import { usePlusTariffRowActions } from './use-plus-tariff-row-actions';

// Plus tariffs always carry a 7-day period, so there is no "draft" tab — the
// status axis is validity only (active / upcoming / past).
type StatusFilter = 'all' | 'active' | 'upcoming' | 'past';

export interface PlusTariffsListViewProps {
  items: readonly PlusTariffListItem[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
  /**
   * List query in flight: the full chrome (header, summary strip, tab strip,
   * table shell) stays mounted while the summary cells, tab counts, and table
   * body swap to skeletons — no generic gray-bar page.
   */
  loading?: boolean;
}

/**
 * The route-open LIST screen for Plus Commission Tariffs. Always renders the
 * full shell — header + actions, summary strip, then one data panel with a
 * status tab strip, a search + column-visibility toolbar, sortable columns,
 * row selection + bulk delete, and pagination. The "no tariffs yet" case lives
 * as an empty state INSIDE the panel so the page never collapses to an empty
 * page. Search + status filtering are owned here so every control stays in sync.
 */
export function PlusTariffsListView({
  items,
  onOpen,
  onCreate,
  onExport,
  onDelete,
  loading = false,
}: PlusTariffsListViewProps): React.ReactElement {
  const t = useTranslations('campaignsPages.plusCommissionTariffs');
  const tList = useTranslations('plusCommissionTariffsPage.list');
  const tTemplates = useTranslations('plusCommissionTariffsPage.templates');
  const tFilters = useTranslations('plusCommissionTariffsPage.filters');
  const tStatus = useTranslations('plusCommissionTariffsPage.listStatus');

  // URL state (nuqs): search + status tab survive reload/share.
  const [urlFilters, setUrlFilters] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      status: parseAsStringEnum<StatusFilter>(['all', 'active', 'upcoming', 'past']).withDefault(
        'all',
      ),
    },
    { history: 'push' },
  );
  const query = urlFilters.q;
  const statusFilter = urlFilters.status;
  // Per-keystroke q writes REPLACE (no letter-by-letter Back history);
  // the status tab keeps the hook-level push.
  const setQuery = (next: string): void => void setUrlFilters({ q: next }, { history: 'replace' });
  const setStatusFilter = (next: StatusFilter): void => void setUrlFilters({ status: next });
  const [deleteTarget, setDeleteTarget] = React.useState<PlusTariffListRow | null>(null);

  const rows = React.useMemo(() => toListRows(items), [items]);
  const queryFiltered = React.useMemo(
    () => rows.filter((row) => matchesPlusTariffQuery(row, query)),
    [rows, query],
  );
  const matchesStatus = React.useCallback(
    (row: PlusTariffListRow): boolean => statusFilter === 'all' || row.validity === statusFilter,
    [statusFilter],
  );
  const filtered = React.useMemo(
    () => queryFiltered.filter(matchesStatus),
    [queryFiltered, matchesStatus],
  );

  // Per-status counts over the search-filtered set, so the tabs reflect the search.
  const statusCounts = React.useMemo(() => {
    const counts = { all: queryFiltered.length, active: 0, upcoming: 0, past: 0 };
    for (const row of queryFiltered) {
      if (row.validity !== null) counts[row.validity] += 1;
    }
    return counts;
  }, [queryFiltered]);

  const hasActiveFilters = query.trim() !== '' || statusFilter !== 'all';

  const stats = React.useMemo(() => summarizePlusTariffList(rows), [rows]);
  const format = useFormatter();

  const requestDelete = React.useCallback((row: PlusTariffListRow) => setDeleteTarget(row), []);
  const actions = usePlusTariffRowActions({ onOpen, onExport, onRequestDelete: requestDelete });

  const clearFilters = React.useCallback(
    () => void setUrlFilters({ q: '', status: 'all' }),
    [setUrlFilters],
  );
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
        loading={loading}
        aria-label={tList('filterLabel')}
        options={[
          { value: 'all', label: tFilters('all'), count: statusCounts.all },
          { value: 'active', label: tStatus('active'), count: statusCounts.active },
          { value: 'upcoming', label: tStatus('upcoming'), count: statusCounts.upcoming },
          { value: 'past', label: tStatus('past'), count: statusCounts.past },
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
        // "trendyol plus" brand wordmark on the title eye-line, so the screen
        // reads as the Trendyol Plus program at a glance.
        badge={<TrendyolPlusLockup className="h-5" />}
        intent={t('intent')}
        // `gap-lg` so the title/intent breathe above the summary strip; no bottom
        // rule so the strip flows into the data panel below rather than being
        // fenced off by a separator.
        className="gap-lg border-b-0 pb-0"
        meta={
          stats.lastUpdatedAt !== null
            ? tList('lastUpdated', {
                date: format.dateTime(new Date(stats.lastUpdatedAt), 'short'),
              })
            : undefined
        }
        summary={<PlusTariffListSummary stats={stats} loading={loading} />}
      />

      <PlusTariffListTable
        rows={filtered}
        loading={loading}
        actions={actions}
        tabsNode={tabsRow}
        searchValue={query}
        onSearchChange={setQuery}
        hasActiveFilters={hasActiveFilters}
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
