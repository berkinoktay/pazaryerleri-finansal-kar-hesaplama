'use client';

import { CloudUploadIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import { parseAsString, parseAsStringEnum, useQueryStates } from 'nuqs';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { FilterTabs } from '@/components/patterns/filter-tabs';
import { PageHeader } from '@/components/patterns/page-header';
import { Button } from '@/components/ui/button';

import type { AdvantageTariffListItem } from '../api/list-advantage-tariffs.api';
import {
  matchesAdvantageTariffQuery,
  statusForRow,
  summarizeAdvantageTariffList,
  toListRows,
  type AdvantageTariffListRow,
} from '../lib/advantage-tariff-list';

import { AdvantageTariffListSummary } from './advantage-tariff-list-summary';
import { AdvantageTariffListTable } from './advantage-tariff-list-table';
import { useAdvantageTariffRowActions } from './use-advantage-tariff-row-actions';

// Advantage files carry no dates, so there is no validity axis — the status tab
// strip is upload/export state only (exported / pending).
type StatusFilter = 'all' | 'exported' | 'pending';

export interface AdvantageTariffsListViewProps {
  items: readonly AdvantageTariffListItem[];
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
 * The route-open LIST screen for Advantage product labels. Always renders the
 * full shell — header + actions, summary strip, then one data panel with a
 * status tab strip, a search + column-visibility toolbar, sortable columns,
 * row selection + bulk delete, and pagination. The "no tariffs yet" case lives
 * as an empty state INSIDE the panel so the page never collapses to an empty
 * page. Search + status filtering are owned here so every control stays in sync.
 * Unlike the commission/Plus lists there is no validity — the status axis is
 * exported vs pending.
 */
export function AdvantageTariffsListView({
  items,
  onOpen,
  onCreate,
  onExport,
  onDelete,
  loading = false,
}: AdvantageTariffsListViewProps): React.ReactElement {
  const t = useTranslations('campaignsPages.productLabels');
  const tList = useTranslations('productLabelsPage.list');
  const tTemplates = useTranslations('productLabelsPage.templates');
  const tListStatus = useTranslations('productLabelsPage.list.listStatus');

  // URL state (nuqs): search + status tab survive reload/share.
  const [urlFilters, setUrlFilters] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      status: parseAsStringEnum<StatusFilter>(['all', 'exported', 'pending']).withDefault('all'),
    },
    { history: 'push' },
  );
  const query = urlFilters.q;
  const statusFilter = urlFilters.status;
  // Per-keystroke q writes REPLACE (no letter-by-letter Back history);
  // the status tab keeps the hook-level push.
  const setQuery = (next: string): void => void setUrlFilters({ q: next }, { history: 'replace' });
  const setStatusFilter = (next: StatusFilter): void => void setUrlFilters({ status: next });
  const [deleteTarget, setDeleteTarget] = React.useState<AdvantageTariffListRow | null>(null);

  const rows = React.useMemo(() => toListRows(items), [items]);
  const queryFiltered = React.useMemo(
    () => rows.filter((row) => matchesAdvantageTariffQuery(row, query)),
    [rows, query],
  );
  const matchesStatus = React.useCallback(
    (row: AdvantageTariffListRow): boolean =>
      statusFilter === 'all' || statusForRow(row) === statusFilter,
    [statusFilter],
  );
  const filtered = React.useMemo(
    () => queryFiltered.filter(matchesStatus),
    [queryFiltered, matchesStatus],
  );

  // Per-status counts over the search-filtered set, so the tabs reflect the search.
  const statusCounts = React.useMemo(() => {
    const counts = { all: queryFiltered.length, exported: 0, pending: 0 };
    for (const row of queryFiltered) {
      counts[statusForRow(row)] += 1;
    }
    return counts;
  }, [queryFiltered]);

  const hasActiveFilters = query.trim() !== '' || statusFilter !== 'all';

  const stats = React.useMemo(() => summarizeAdvantageTariffList(rows), [rows]);
  const format = useFormatter();

  const requestDelete = React.useCallback(
    (row: AdvantageTariffListRow) => setDeleteTarget(row),
    [],
  );
  const actions = useAdvantageTariffRowActions({
    onOpen,
    onExport,
    onRequestDelete: requestDelete,
  });

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
          { value: 'all', label: tListStatus('all'), count: statusCounts.all },
          { value: 'exported', label: tListStatus('exported'), count: statusCounts.exported },
          { value: 'pending', label: tListStatus('pending'), count: statusCounts.pending },
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
        variant="framed"
        title={t('title')}
        intent={t('intent')}
        meta={
          stats.lastUpdatedAt !== null
            ? tList('lastUpdated', {
                date: format.dateTime(new Date(stats.lastUpdatedAt), 'short'),
              })
            : undefined
        }
        summary={<AdvantageTariffListSummary stats={stats} loading={loading} />}
      />

      <AdvantageTariffListTable
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
