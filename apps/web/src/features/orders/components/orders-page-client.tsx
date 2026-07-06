'use client';

import { RefreshIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { DateRangePicker } from '@/components/patterns/date-range-picker';
import { PageHeader } from '@/components/patterns/page-header';
import { SyncBadge, type SyncState } from '@/components/patterns/sync-badge';
import { SyncCenter, type SyncCenterLog } from '@/components/patterns/sync-center';
import { Button } from '@/components/ui/button';
import { type SyncLog } from '@/features/sync/api/list-org-sync-logs.api';
import { useStoreSyncs } from '@/features/sync/hooks/use-store-syncs';
import { cn } from '@/lib/utils';

import { useOrders } from '../hooks/use-orders';
import { useOrdersFilters } from '../hooks/use-orders-filters';
import { useOrdersSummary } from '../hooks/use-orders-summary';
import { useRefreshOrders } from '../hooks/use-refresh-orders';
import { orderDateRangeFromParams, orderDateRangeToParams } from '../lib/orders-date-range';

import { OrderDetailModal, type OrderDetailModalSelection } from './order-detail-modal';
import { OrdersEmptyState } from './orders-empty-state';
import { OrdersKpiStrip } from './orders-kpi-strip';
import { OrdersTable } from './orders-table';

interface OrdersPageClientProps {
  orgId: string | null;
  storeId: string | null;
  pageTitle: string;
  pageIntent: string;
}

/**
 * Top-level client component for the orders page. Owns URL state via
 * useOrdersFilters and server state via useOrders. Mounts the filter
 * toolbar + table + pagination inside the integrated DataTable shell.
 * Renders the no-store empty state when the user has not finished
 * connecting a marketplace account yet.
 *
 * The header is the framed PageHeader: the orderDate DateRangePicker sits in
 * the `filters` slot, the SyncBadge freshness pill rides the `meta` status row
 * (the top line of the right cluster), the Refresh action sits alone in
 * `actions` (the controls row directly below the status row), and the KPI
 * summary docks into the `summary` slot as a bare StatStrip. The summary is
 * omitted only on a summary-query error with NO previously-cached data — a
 * stale-but-present summary keeps rendering; the failure still surfaces via the
 * global QueryCache toast.
 */
export function OrdersPageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: OrdersPageClientProps): React.ReactElement {
  const tOrders = useTranslations('ordersPage');
  const tSync = useTranslations('syncCenter');
  const { filters, setFilters } = useOrdersFilters();
  const [syncCenterOpen, setSyncCenterOpen] = React.useState(false);
  const [selectedOrder, setSelectedOrder] = React.useState<OrderDetailModalSelection | null>(null);

  const noStoreSelected = orgId === null || storeId === null;

  const ordersQuery = useOrders(
    noStoreSelected
      ? null
      : {
          orgId,
          storeId,
          q: filters.q.length > 0 ? filters.q : undefined,
          status: filters.status ?? undefined,
          reconciliationStatus: filters.reconciliationStatus ?? undefined,
          costStatus: filters.costStatus,
          lossOnly: filters.lossOnly,
          from: filters.from.length > 0 ? filters.from : undefined,
          to: filters.to.length > 0 ? filters.to : undefined,
          sort: filters.sort,
          page: filters.page,
          perPage: filters.perPage,
        },
  );
  const summaryQuery = useOrdersSummary(
    noStoreSelected
      ? null
      : {
          orgId,
          storeId,
          q: filters.q.length > 0 ? filters.q : undefined,
          status: filters.status ?? undefined,
          reconciliationStatus: filters.reconciliationStatus ?? undefined,
          costStatus: filters.costStatus,
          lossOnly: filters.lossOnly,
          from: filters.from.length > 0 ? filters.from : undefined,
          to: filters.to.length > 0 ? filters.to : undefined,
        },
  );
  const { activeSyncs, recentSyncs } = useStoreSyncs(storeId);
  const refresh = useRefreshOrders(orgId, storeId);

  if (noStoreSelected) {
    return (
      <>
        <PageHeader variant="framed" title={pageTitle} intent={pageIntent} />
        <OrdersEmptyState variant="no-store" />
      </>
    );
  }

  const rows = ordersQuery.data?.data ?? [];
  const pagination = ordersQuery.data?.pagination ?? {
    page: filters.page,
    perPage: filters.perPage,
    total: 0,
    totalPages: 0,
  };
  const counts = ordersQuery.data?.counts ?? { calculated: 0, excluded: 0 };
  const noOrdersAtAll = counts.calculated === 0 && counts.excluded === 0;

  const hasAnyFilter =
    filters.q.length > 0 ||
    filters.status !== null ||
    filters.reconciliationStatus !== null ||
    filters.lossOnly ||
    filters.from.length > 0 ||
    filters.to.length > 0;

  const orderSyncSnapshot = derivedSyncSnapshot(activeSyncs, recentSyncs);
  const syncCenterLogs = toSyncCenterLogs(activeSyncs, recentSyncs);

  // Refresh is a client-side cache invalidate only (no vendor POST), so the
  // button only guards its own brief in-flight state.
  const refreshButtonDisabled = refresh.isPending;

  // SyncBadge (freshness) rides the framed header's status row — the top line of
  // the right cluster, directly ABOVE the controls row (design spec D10: the
  // freshness pill sits right above the Refresh button). Passed via `meta`.
  const headerMeta = (
    <SyncBadge
      state={orderSyncSnapshot.state}
      lastSyncedAt={orderSyncSnapshot.lastSyncedAt}
      progress={orderSyncSnapshot.progress}
      activeCount={activeSyncs.length}
      source="Trendyol"
      onClick={() => setSyncCenterOpen(true)}
      ariaLabel={tSync('openLabel')}
    />
  );

  // Controls row: the Refresh action alone now that the freshness pill moved to
  // the status row above it.
  const headerActions = (
    <Button
      type="button"
      size="sm"
      onClick={() => refresh.mutate()}
      disabled={refreshButtonDisabled}
      className="gap-xs"
    >
      <RefreshIcon className={cn('size-icon-sm', refreshButtonDisabled && 'animate-spin')} />
      {refreshButtonDisabled ? tOrders('refreshButton.refreshing') : tOrders('refreshButton.label')}
    </Button>
  );

  // orderDate range as a page-scope filter — it recomputes the summary + list,
  // so it lives in the header's `filters` slot (left of the action cluster),
  // bound to the same nuqs from/to state via the shared conversion helpers.
  const headerFilters = (
    <DateRangePicker
      value={orderDateRangeFromParams(filters.from, filters.to)}
      onChange={(next) => setFilters(orderDateRangeToParams(next))}
    />
  );

  // The genuinely-empty store (zero rows, no filter active) shows a welcoming
  // "no orders yet" body INSIDE the table chrome rather than a full-page
  // takeover — the table keeps its toolbar + headers + pagination so the page
  // shape stays stable. With a filter active this is left undefined so the
  // DataTable's "clear filters" no-results affordance surfaces instead.
  const ordersEmptyBody =
    !hasAnyFilter && noOrdersAtAll ? <OrdersEmptyState variant="no-orders" embedded /> : undefined;

  return (
    <>
      <div className="gap-lg flex flex-col">
        <PageHeader
          variant="framed"
          title={pageTitle}
          intent={pageIntent}
          meta={headerMeta}
          filters={headerFilters}
          actions={headerActions}
          summary={
            // React Query keeps the last successful `data` even when a background
            // refetch errors, so drop the summary only on an error with NO prior
            // data; a stale-but-present summary keeps rendering instead of blanking.
            summaryQuery.isError && summaryQuery.data === undefined ? undefined : (
              <OrdersKpiStrip summary={summaryQuery.data} loading={summaryQuery.isPending} />
            )
          }
        />
        <OrdersTable
          rows={rows}
          loading={ordersQuery.isLoading}
          empty={ordersEmptyBody}
          pagination={pagination}
          filters={{
            q: filters.q,
            status: filters.status,
            reconciliationStatus: filters.reconciliationStatus,
            lossOnly: filters.lossOnly,
            from: filters.from,
            to: filters.to,
          }}
          costStatus={filters.costStatus}
          sort={filters.sort}
          counts={counts}
          tabsLoading={ordersQuery.isLoading}
          onCostStatusChange={(next) => setFilters({ costStatus: next })}
          onSortChange={(next) => setFilters({ sort: next })}
          onRowOpen={(id) => {
            const selected = rows.find((row) => row.id === id);
            if (selected !== undefined) {
              setSelectedOrder({
                id,
                title: selected.platformOrderNumber ?? selected.platformOrderId,
                orderDate: selected.orderDate,
              });
            }
          }}
          onFiltersChange={(next) =>
            setFilters({
              ...(next.q !== undefined ? { q: next.q } : {}),
              ...(next.status !== undefined ? { status: next.status } : {}),
              ...(next.reconciliationStatus !== undefined
                ? { reconciliationStatus: next.reconciliationStatus }
                : {}),
              ...(next.lossOnly !== undefined ? { lossOnly: next.lossOnly } : {}),
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

      <OrderDetailModal
        orgId={orgId}
        storeId={storeId}
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
      />

      <SyncCenter
        open={syncCenterOpen}
        onOpenChange={setSyncCenterOpen}
        logs={syncCenterLogs}
        triggers={[]}
      />
    </>
  );
}

interface SyncSnapshot {
  state: SyncState;
  lastSyncedAt: Date | string | null;
  progress?: { current: number; total: number | null };
}

/**
 * Project the ORDERS sync log slice into a SyncBadge-friendly snapshot.
 * Mirrors the PRODUCTS variant in features/products — provider already
 * splits rows into active (PENDING/RUNNING/FAILED_RETRYABLE) vs recent
 * (COMPLETED/FAILED) buckets, so this is a thin "first ORDERS log per
 * bucket wins" projection.
 */
function derivedSyncSnapshot(activeSyncs: SyncLog[], recentSyncs: SyncLog[]): SyncSnapshot {
  const active = activeSyncs.find((l) => l.syncType === 'ORDERS');
  if (active !== undefined) {
    return {
      state: active.status === 'FAILED_RETRYABLE' ? 'retrying' : 'syncing',
      lastSyncedAt: active.startedAt,
      progress: { current: active.progressCurrent, total: active.progressTotal },
    };
  }
  const recent = recentSyncs.find((l) => l.syncType === 'ORDERS');
  if (recent === undefined) {
    return { state: 'fresh', lastSyncedAt: null };
  }
  if (recent.status === 'FAILED') {
    return { state: 'failed', lastSyncedAt: recent.completedAt ?? recent.startedAt };
  }
  return { state: 'fresh', lastSyncedAt: recent.completedAt ?? recent.startedAt };
}

function toSyncCenterLogs(activeSyncs: SyncLog[], recentSyncs: SyncLog[]): SyncCenterLog[] {
  return [...activeSyncs, ...recentSyncs].map(projectSyncLog);
}

function projectSyncLog(log: SyncLog): SyncCenterLog {
  return {
    id: log.id,
    storeId: log.storeId,
    syncType: log.syncType,
    status: log.status,
    startedAt: log.startedAt,
    completedAt: log.completedAt,
    recordsProcessed: log.recordsProcessed,
    progressCurrent: log.progressCurrent,
    progressTotal: log.progressTotal,
    errorCode: log.errorCode,
    errorMessage: log.errorMessage,
    attemptCount: log.attemptCount,
    nextAttemptAt: log.nextAttemptAt,
    skippedPages: log.skippedPages,
  };
}
