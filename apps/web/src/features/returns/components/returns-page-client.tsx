'use client';

import * as React from 'react';

import { DateRangePicker } from '@/components/patterns/date-range-picker';
import { PageHeader } from '@/components/patterns/page-header';
import { SyncCenter } from '@/components/patterns/sync-center';
import { PageSyncControl } from '@/features/sync/components/page-sync-control';
import { PageSyncFooterTrace } from '@/features/sync/components/page-sync-footer-trace';
import { StaleDataBanner } from '@/features/sync/components/stale-data-banner';
import { useStoreSyncs } from '@/features/sync/hooks/use-store-syncs';
import { toSyncCenterLogs } from '@/features/sync/lib/derive-sync-snapshot';
import { dateRangeFromParams, dateRangeToParams } from '@/lib/date-range-params';

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
 * Read-only V1: claim rows arrive from the 6h CLAIMS cron; the header holds
 * the unified PageSyncControl (freshness + manual CLAIMS sync + source
 * breakdown). Its onFlowsSettled refreshes the list + KPI caches when a
 * returns-page sync completes (no vendor call — mirrors the orders page).
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
        <PageHeader variant="framed" title={pageTitle} intent={pageIntent} />
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

  const syncCenterLogs = toSyncCenterLogs(activeSyncs, recentSyncs);

  // Controls row: the unified freshness control owns freshness + the manual
  // CLAIMS sync + the source breakdown popover. onFlowsSettled invalidates the
  // list + KPI caches the moment a returns-page sync completes (replaces the
  // former client-side "Yenile" button).
  const headerActions = (
    <PageSyncControl
      pageKey="returns"
      onOpenHistory={() => setSyncCenterOpen(true)}
      onFlowsSettled={() => refresh.mutate()}
    />
  );

  // claimDate range as a page-scope filter — it recomputes the summary + list,
  // so it lives in the header's `filters` slot (left of the action cluster),
  // bound to the same nuqs from/to state via the shared conversion helpers.
  // Both bounds empty => no params sent, so the backend applies its 30-day
  // default; the window is never re-derived on the FE.
  const headerFilters = (
    <DateRangePicker
      value={dateRangeFromParams(filters.from, filters.to)}
      onChange={(next) => setFilters(dateRangeToParams(next))}
    />
  );

  return (
    <>
      <div className="gap-lg flex flex-col">
        <PageHeader
          variant="framed"
          title={pageTitle}
          intent={pageIntent}
          filters={headerFilters}
          actions={headerActions}
          summary={
            // React Query keeps the last successful `data` even when a background
            // refetch errors, so drop the summary only on an error with NO prior
            // data; a stale-but-present summary keeps rendering instead of blanking.
            summaryQuery.isError && summaryQuery.data === undefined ? undefined : (
              <ReturnsKpiStrip summary={summaryQuery.data} loading={summaryQuery.isPending} />
            )
          }
        />
        {/* Aged-data warning strip (in content flow, between header and table). */}
        <StaleDataBanner pageKey="returns" />
        <ReturnsTable
          rows={rows}
          loading={returnsQuery.isLoading}
          paginationLeading={<PageSyncFooterTrace pageKey="returns" />}
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
