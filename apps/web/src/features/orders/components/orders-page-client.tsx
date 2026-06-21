'use client';

import { RefreshIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { SyncBadge, type SyncState } from '@/components/patterns/sync-badge';
import { SyncCenter, type SyncCenterLog } from '@/components/patterns/sync-center';
import { Button } from '@/components/ui/button';
import { type SyncLog } from '@/features/sync/api/list-org-sync-logs.api';
import { useStoreSyncs } from '@/features/sync/hooks/use-store-syncs';
import { cn } from '@/lib/utils';

import { useOrders } from '../hooks/use-orders';
import { useOrdersFilters } from '../hooks/use-orders-filters';
import { useRefreshOrders } from '../hooks/use-refresh-orders';
import {
  type OrderStatusValue,
  type ReconciliationStatusValue,
} from '../lib/orders-filter-parsers';

import { OrdersEmptyState } from './orders-empty-state';
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
 * The PageHeader hosts the data-freshness surface (SyncBadge in `meta`)
 * and the primary action (Eşitle button in `actions`). Mirrors the
 * products page composition so the trust-signal pattern reads the same
 * across data-source pages.
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
          from: filters.from.length > 0 ? filters.from : undefined,
          to: filters.to.length > 0 ? filters.to : undefined,
          sort: filters.sort,
          page: filters.page,
          perPage: filters.perPage,
        },
  );
  const { activeSyncs, recentSyncs } = useStoreSyncs(storeId);
  const refresh = useRefreshOrders(orgId, storeId);

  if (noStoreSelected) {
    return (
      <>
        <PageHeader title={pageTitle} intent={pageIntent} />
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
    filters.from.length > 0 ||
    filters.to.length > 0;

  const orderSyncSnapshot = derivedSyncSnapshot(activeSyncs, recentSyncs);
  const syncCenterLogs = toSyncCenterLogs(activeSyncs, recentSyncs);

  // Refresh is a client-side cache invalidate only (no vendor POST), so the
  // button only guards its own brief in-flight state.
  const refreshButtonDisabled = refresh.isPending;

  // SyncBadge (freshness) grouped with the refresh action in the right
  // cluster — one unit (design spec D10), no separate meta row.
  const headerSlots = {
    actions: (
      <>
        <SyncBadge
          state={orderSyncSnapshot.state}
          lastSyncedAt={orderSyncSnapshot.lastSyncedAt}
          progress={orderSyncSnapshot.progress}
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
            ? tOrders('refreshButton.refreshing')
            : tOrders('refreshButton.label')}
        </Button>
      </>
    ),
  };

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
        <PageHeader title={pageTitle} intent={pageIntent} actions={headerSlots.actions} />
        <OrdersTable
          rows={rows}
          loading={ordersQuery.isLoading}
          empty={ordersEmptyBody}
          pagination={pagination}
          filters={{
            q: filters.q,
            status: filters.status,
            reconciliationStatus: filters.reconciliationStatus,
            from: filters.from,
            to: filters.to,
          }}
          costStatus={filters.costStatus}
          sort={filters.sort}
          counts={counts}
          tabsLoading={ordersQuery.isLoading}
          onCostStatusChange={(next) => setFilters({ costStatus: next })}
          onSortChange={(next) => setFilters({ sort: next })}
          onFiltersChange={(next) =>
            setFilters({
              ...(next.q !== undefined ? { q: next.q } : {}),
              ...(next.status !== undefined
                ? { status: next.status as OrderStatusValue | null }
                : {}),
              ...(next.reconciliationStatus !== undefined
                ? {
                    reconciliationStatus:
                      next.reconciliationStatus as ReconciliationStatusValue | null,
                  }
                : {}),
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
