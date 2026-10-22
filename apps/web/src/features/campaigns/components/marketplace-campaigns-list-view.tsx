'use client';

import { CloudUploadIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import { parseAsString, parseAsStringEnum, useQueryStates } from 'nuqs';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { FilterTabs } from '@/components/patterns/filter-tabs';
import { PageHeader } from '@/components/patterns/page-header';
import { SearchInput } from '@/components/patterns/search-input';
import { Button } from '@/components/ui/button';

import type { MarketplaceCampaignListItem } from '../api/list-marketplace-campaigns.api';
import {
  matchesMarketplaceCampaignQuery,
  statusForRow,
  summarizeMarketplaceCampaigns,
  toListRows,
  type MarketplaceCampaignListRow,
} from '../lib/marketplace-campaign-list';

import { MarketplaceCampaignsMobileCards } from './marketplace-campaigns-mobile-cards';
import { MarketplaceCampaignsSummary } from './marketplace-campaigns-summary';
import { MarketplaceCampaignsTable } from './marketplace-campaigns-table';
import { useMarketplaceCampaignRowActions } from './use-marketplace-campaign-row-actions';

// The campaign window is shown as its own column, not folded into a validity state — the status
// tab strip is upload/export state only (exported / pending).
type StatusFilter = 'all' | 'exported' | 'pending';

export interface MarketplaceCampaignsListViewProps {
  items: readonly MarketplaceCampaignListItem[];
  onOpen: (id: string) => void;
  /** Opens the upload dialog (tab-row button + the first-run empty state). */
  onCreate: () => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
  /**
   * List query in flight: the full chrome (header, summary strip, tab strip, table shell) stays
   * mounted while the summary cells, tab counts, table body and mobile cards swap to skeletons —
   * no generic gray-bar page.
   */
  loading?: boolean;
}

/**
 * The route-open LIST screen for Kampanyalar. Always renders the full shell — header, summary
 * strip, then the data panel: a status tab strip, search, sortable columns, row selection + bulk
 * delete and pagination on desktop; the same tab strip + search over a card list below `md`. The
 * "no uploads yet" case lives as an empty state INSIDE the panel so the page never collapses.
 * Search + status filtering are owned here so the desktop and mobile controls stay in sync.
 */
export function MarketplaceCampaignsListView({
  items,
  onOpen,
  onCreate,
  onExport,
  onDelete,
  loading = false,
}: MarketplaceCampaignsListViewProps): React.ReactElement {
  const t = useTranslations('campaignsPages.marketplaceCampaigns');
  const tList = useTranslations('marketplaceCampaignsPage.list');
  const tTemplates = useTranslations('marketplaceCampaignsPage.templates');
  const tListStatus = useTranslations('marketplaceCampaignsPage.list.listStatus');

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
  // Per-keystroke q writes REPLACE (no letter-by-letter Back history); the status tab keeps the
  // hook-level push.
  const setQuery = (next: string): void => void setUrlFilters({ q: next }, { history: 'replace' });
  const setStatusFilter = (next: StatusFilter): void => void setUrlFilters({ status: next });
  const [deleteTarget, setDeleteTarget] = React.useState<MarketplaceCampaignListRow | null>(null);

  const rows = React.useMemo(() => toListRows(items), [items]);
  const queryFiltered = React.useMemo(
    () => rows.filter((row) => matchesMarketplaceCampaignQuery(row, query)),
    [rows, query],
  );
  const matchesStatus = React.useCallback(
    (row: MarketplaceCampaignListRow): boolean =>
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

  const stats = React.useMemo(() => summarizeMarketplaceCampaigns(rows), [rows]);
  const format = useFormatter();

  const requestDelete = React.useCallback(
    (row: MarketplaceCampaignListRow) => setDeleteTarget(row),
    [],
  );
  const actions = useMarketplaceCampaignRowActions({
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

  // The data panel's top row: status tabs on the left, the upload action on the right — so
  // "Upload Excel" sits next to the data it feeds (it wraps under the tabs on a phone).
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
        summary={<MarketplaceCampaignsSummary stats={stats} loading={loading} />}
      />

      <div className="hidden min-w-0 md:block">
        <MarketplaceCampaignsTable
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
      </div>
      <div className="gap-sm flex flex-col md:hidden">
        {tabsRow}
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder={tList('search')}
          aria-label={tList('search')}
        />
        <MarketplaceCampaignsMobileCards
          rows={filtered}
          loading={loading}
          actions={actions}
          onOpen={onOpen}
          onUpload={onCreate}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
        />
      </div>

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
