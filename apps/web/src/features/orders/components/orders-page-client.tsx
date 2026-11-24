'use client';

import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { DateRangePicker } from '@/components/patterns/date-range-picker';
import { PageHeader } from '@/components/patterns/page-header';
import { SyncCenter } from '@/components/patterns/sync-center';
import { PageSyncControl } from '@/features/sync/components/page-sync-control';
import { PageSyncFooterTrace } from '@/features/sync/components/page-sync-footer-trace';
import { StaleDataBanner } from '@/features/sync/components/stale-data-banner';
import { useStoreSyncs } from '@/features/sync/hooks/use-store-syncs';
import { toSyncCenterLogs } from '@/features/sync/lib/derive-sync-snapshot';
import {
  businessDateToPickerDate,
  dateRangeFromParams,
  dateRangeToParams,
} from '@/lib/date-range-params';
import { useBusinessDayRollover } from '@/lib/use-business-day-rollover';

import { useFinalizingPoll } from '../hooks/use-finalizing-poll';
import { useOrders } from '../hooks/use-orders';
import { useOrdersFilters } from '../hooks/use-orders-filters';
import { useOrdersRealtimeRefresh } from '../hooks/use-orders-realtime-refresh';
import { useOrdersSummary } from '../hooks/use-orders-summary';
import { useRefreshOrders } from '../hooks/use-refresh-orders';
import { orderKeys } from '../query-keys';

import { OrderDetailSheet, type OrderDetailSelection } from './order-detail-sheet';
import { OrdersEmptyState } from './orders-empty-state';
import { OrdersKpiStrip } from './orders-kpi-strip';
import { OrdersOpenDayNotice } from './orders-open-day-notice';
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
 *
 * The list shows completed business days only; the server says which day is
 * open in the list response's `openDay`. The page never decides visibility with
 * the client clock: it uses the clock only to schedule a refetch at the day
 * boundary, and while a completed day is still being finalised it polls (one
 * shared decision and cap for the list and the KPI summary).
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

  // One poll decision for both queries: the list records what each response
  // says about `finalizing`, the summary follows it and stops at the same cap.
  const poll = useFinalizingPoll();
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
    { pollInterval: poll.fromList },
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
    { pollInterval: poll.forSummary },
  );
  const { activeSyncs, recentSyncs } = useStoreSyncs(storeId);
  const refresh = useRefreshOrders(orgId, storeId);
  const queryClient = useQueryClient();
  const openDay = ordersQuery.data?.openDay;
  const finalizing = openDay?.finalizing;

  // Completed-day order inserts over Realtime (a midnight buffer graduation, a
  // late arrival): the live notifier publishes their ids on the recent-orders
  // bus, so refetch the list + KPI to bring them in. Today's inserts are not
  // published; the list hides them until the day ends. Reuses the page's own
  // refresh (the SAME invalidation the header control runs on onFlowsSettled)
  // and coalesces a burst of ids into one refetch.
  useOrdersRealtimeRefresh(() => refresh.mutate());

  // At the end of the open business day its orders join the list: refetch both
  // queries, and keep asking until the server's open date moves on.
  useBusinessDayRollover(openDay?.businessDate, () => refresh.mutate());

  // The trailing summary refetch. When the list first reports that finalising
  // is over, the re-render cancels the summary's pending poll, so whatever was
  // finalised since its previous poll would never reach the KPI strip. It fires
  // on the last KNOWN state going true -> false: an undefined in between (a
  // filter, sort or page change swapping the list query) keeps the last known
  // state, so finalising that ends during the swap still refetches; a first load
  // (nothing known -> false) does not. The list was just fetched, so only the
  // summary is invalidated.
  const lastKnownFinalizingRef = React.useRef<boolean | undefined>(finalizing);
  React.useEffect(() => {
    if (finalizing === undefined) return;
    const previous = lastKnownFinalizingRef.current;
    lastKnownFinalizingRef.current = finalizing;
    if (previous !== true || finalizing !== false) return;
    if (orgId === null || storeId === null) return;
    void queryClient.invalidateQueries({ queryKey: orderKeys.summaries(orgId, storeId) });
  }, [finalizing, orgId, storeId, queryClient]);

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
  // Days after the last completed business day cannot be picked; until the
  // first response names that day the server's clamp alone applies.
  const headerFilters = (
    <DateRangePicker
      value={dateRangeFromParams(filters.from, filters.to)}
      onChange={(next) => setFilters(dateRangeToParams(next))}
      disabledAfter={businessDateToPickerDate(openDay?.lastCompletedBusinessDate ?? '')}
    />
  );

  // The genuinely-empty store (zero rows, no filter active) shows a welcoming
  // "no orders yet" body INSIDE the table chrome rather than a full-page
  // takeover — the table keeps its toolbar + headers + pagination so the page
  // shape stays stable. A store whose only orders are today's gets a pointer to
  // live performance instead. With a filter active this is left undefined so the
  // DataTable's "clear filters" no-results affordance surfaces instead.
  const ordersEmptyBody =
    !hasAnyFilter && noOrdersAtAll ? (
      <OrdersEmptyState
        variant={(openDay?.todayOrderCount ?? 0) > 0 ? 'open-day-only' : 'no-orders'}
        embedded
      />
    ) : undefined;

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
              <OrdersKpiStrip summary={summaryQuery.data} loading={summaryQuery.isPending} />
            )
          }
        />
        {/* Aged-data warning strip (in content flow, between header and table). */}
        <StaleDataBanner pageKey="orders" />
        {/* The open (today's) day the list leaves out: finalising note, today's
            pointer to live performance, today's search matches. */}
        <OrdersOpenDayNotice openDay={openDay} hideTodayNotice={ordersEmptyBody !== undefined} />
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
    </>
  );
}
