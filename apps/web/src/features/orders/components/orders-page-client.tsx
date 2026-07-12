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

import { useOrders } from '../hooks/use-orders';
import { useOrdersFilters } from '../hooks/use-orders-filters';
import { useOrdersRealtimeRefresh } from '../hooks/use-orders-realtime-refresh';
import { useOrdersSummary } from '../hooks/use-orders-summary';
import { RecentOrderIdsProvider } from '../hooks/use-recent-order-ids';
import { useRefreshOrders } from '../hooks/use-refresh-orders';

import { OrderDetailSheet, type OrderDetailSelection } from './order-detail-sheet';
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
 * the `filters` slot, the `actions` row holds the unified PageSyncControl
 * (freshness + manual ORDERS sync + source breakdown), and the KPI summary docks
 * into the `summary` slot as a bare StatStrip. The list + KPI refresh
 * automatically when an orders-page sync finishes (PageSyncControl's
 * onFlowsSettled). The summary is omitted only on a summary-query error with NO
 * previously-cached data — a stale-but-present summary keeps rendering; the
 * failure still surfaces via the global QueryCache toast.
 */
export function OrdersPageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: OrdersPageClientProps): React.ReactElement {
  const { filters, setFilters } = useOrdersFilters();
  const [syncCenterOpen, setSyncCenterOpen] = React.useState(false);
  const [selectedOrder, setSelectedOrder] = React.useState<OrderDetailSelection | null>(null);

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

  // Realtime new-order inserts (#467): when the live notifier announces a new
  // order over the recent-orders bus, refetch the list + KPI so the new row
  // actually appears (and its row highlight paints against a fetched row rather
  // than arming for nothing). Reuses the page's own refresh — the SAME
  // invalidation the header control runs on onFlowsSettled — and coalesces a
  // burst of ids into one refetch.
  useOrdersRealtimeRefresh(() => refresh.mutate());

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

  const syncCenterLogs = toSyncCenterLogs(activeSyncs, recentSyncs);

  // Controls row: the unified freshness control owns freshness + the manual
  // ORDERS sync + the source breakdown popover. onFlowsSettled invalidates the
  // list + KPI caches the moment an orders-page sync completes (replaces the
  // former client-side "Yenile" button).
  const headerActions = (
    <PageSyncControl
      pageKey="orders"
      onOpenHistory={() => setSyncCenterOpen(true)}
      onFlowsSettled={() => refresh.mutate()}
    />
  );

  // orderDate range as a page-scope filter — it recomputes the summary + list,
  // so it lives in the header's `filters` slot (left of the action cluster),
  // bound to the same nuqs from/to state via the shared conversion helpers.
  const headerFilters = (
    <DateRangePicker
      value={dateRangeFromParams(filters.from, filters.to)}
      onChange={(next) => setFilters(dateRangeToParams(next))}
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
    <RecentOrderIdsProvider>
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
              <OrdersKpiStrip summary={summaryQuery.data} loading={summaryQuery.isPending} />
            )
          }
        />
        {/* Aged-data warning strip (in content flow, between header and table). */}
        <StaleDataBanner pageKey="orders" />
        <OrdersTable
          rows={rows}
          loading={ordersQuery.isLoading}
          empty={ordersEmptyBody}
          paginationLeading={<PageSyncFooterTrace pageKey="orders" />}
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

      <OrderDetailSheet
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
    </RecentOrderIdsProvider>
  );
}
