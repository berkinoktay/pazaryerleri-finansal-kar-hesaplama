'use client';

import { RefreshIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { SyncBadge } from '@/components/patterns/sync-badge';
import { SyncCenter } from '@/components/patterns/sync-center';
import { Button } from '@/components/ui/button';
import { useStoreSyncs } from '@/features/sync/hooks/use-store-syncs';
import { deriveSyncSnapshot, toSyncCenterLogs } from '@/features/sync/lib/derive-sync-snapshot';
import { cn } from '@/lib/utils';

import { useRefreshReturns } from '../hooks/use-refresh-returns';
import { useReturns } from '../hooks/use-returns';
import { useReturnsFilters } from '../hooks/use-returns-filters';
import { useReturnsSummary } from '../hooks/use-returns-summary';

import { ReturnsEmptyState } from './returns-empty-state';
import { ReturnsKpiStrip } from './returns-kpi-strip';
import { ReturnsTable } from './returns-table';

interface ReturnsPageClientProps {
  orgId: string | null;
  storeId: string | null;
  pageTitle: string;
  pageIntent: string;
}

/**
 * Top-level client component for the returns page. Owns URL state via
 * useReturnsFilters and server state via useReturns / useReturnsSummary.
 * Read-only V1: claim rows arrive from the 6h CLAIMS cron; the header
 * pairs a CLAIMS SyncBadge (freshness + sync center) with a cache-refresh
 * button (no vendor call — mirrors the orders page contract).
 *
 * The KPI strip and table ALWAYS render once a store is selected — an
 * empty dataset shows the table's embedded empty state instead of a
 * full-page takeover, so the page's shape stays stable (Berkin, PR #308
 * review).
 *
 * The KPI period follows the table's from/to filter; when both are empty
 * the params are OMITTED so the backend applies its own 30-day default
 * (spec §5.2) — the window is never re-derived on the FE.
 */
export function ReturnsPageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: ReturnsPageClientProps): React.ReactElement {
  const tReturns = useTranslations('returnsPage');
  const tSync = useTranslations('syncCenter');
  const { filters, setFilters } = useReturnsFilters();
  const [syncCenterOpen, setSyncCenterOpen] = React.useState(false);

  const noStoreSelected = orgId === null || storeId === null;

  const returnsQuery = useReturns(
    noStoreSelected
      ? null
      : {
          orgId,
          storeId,
          q: filters.q.length > 0 ? filters.q : undefined,
          status: filters.status === 'all' ? undefined : filters.status,
          from: filters.from.length > 0 ? filters.from : undefined,
          to: filters.to.length > 0 ? filters.to : undefined,
          page: filters.page,
          perPage: filters.perPage,
        },
  );
  const summaryQuery = useReturnsSummary(
    noStoreSelected
      ? null
      : {
          orgId,
          storeId,
          from: filters.from.length > 0 ? filters.from : undefined,
          to: filters.to.length > 0 ? filters.to : undefined,
        },
  );
  const { activeSyncs, recentSyncs } = useStoreSyncs(storeId);
  const refresh = useRefreshReturns(orgId, storeId);

  if (noStoreSelected) {
    return (
      <>
        <PageHeader title={pageTitle} intent={pageIntent} />
        <ReturnsEmptyState variant="no-store" />
      </>
    );
  }

  const rows = returnsQuery.data?.data ?? [];
  const pagination = returnsQuery.data?.pagination ?? {
    page: filters.page,
    perPage: filters.perPage,
    total: 0,
    totalPages: 0,
  };
  const counts = returnsQuery.data?.counts ?? { all: 0, open: 0, resolved: 0 };

  const claimsSyncSnapshot = deriveSyncSnapshot('CLAIMS', activeSyncs, recentSyncs);
  const syncCenterLogs = toSyncCenterLogs(activeSyncs, recentSyncs);

  // Refresh is a client-side cache invalidate only (no vendor POST), so the
  // button only guards its own brief in-flight state.
  const refreshButtonDisabled = refresh.isPending;

  const headerActions = (
    <>
      <SyncBadge
        state={claimsSyncSnapshot.state}
        lastSyncedAt={claimsSyncSnapshot.lastSyncedAt}
        progress={claimsSyncSnapshot.progress}
        activeCount={activeSyncs.length}
        source="Trendyol"
        onClick={() => setSyncCenterOpen(true)}
        ariaLabel={tSync('openLabel')}
      />
      <Button
        type="button"
        size="sm"
        onClick={() => refresh.mutate()}
        disabled={refreshButtonDisabled}
        className="gap-xs"
      >
        <RefreshIcon className={cn('size-icon-sm', refreshButtonDisabled && 'animate-spin')} />
        {refreshButtonDisabled
          ? tReturns('refreshButton.refreshing')
          : tReturns('refreshButton.label')}
      </Button>
    </>
  );

  return (
    <>
      <div className="gap-lg flex flex-col">
        <PageHeader title={pageTitle} intent={pageIntent} actions={headerActions} />
        <ReturnsKpiStrip
          summary={summaryQuery.data}
          loading={summaryQuery.isPending}
          error={summaryQuery.isError}
        />
        <ReturnsTable
          rows={rows}
          loading={returnsQuery.isLoading}
          pagination={pagination}
          filters={{ q: filters.q, from: filters.from, to: filters.to }}
          status={filters.status}
          counts={counts}
          tabsLoading={returnsQuery.isLoading}
          onStatusChange={(next) => setFilters({ status: next })}
          onFiltersChange={(next) =>
            setFilters({
              ...(next.q !== undefined ? { q: next.q } : {}),
              ...(next.from !== undefined ? { from: next.from } : {}),
              ...(next.to !== undefined ? { to: next.to } : {}),
            })
          }
          onPaginationChange={(next) =>
            setFilters({
              ...(next.page !== undefined ? { page: next.page } : {}),
              ...(next.perPage !== undefined ? { perPage: next.perPage } : {}),
            })
          }
        />
      </div>

      <SyncCenter
        open={syncCenterOpen}
        onOpenChange={setSyncCenterOpen}
        logs={syncCenterLogs}
        triggers={[]}
      />
    </>
  );
}
