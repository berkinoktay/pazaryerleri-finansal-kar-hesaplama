'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { SyncBadge, type SyncState } from '@/components/patterns/sync-badge';
import { SyncCenter, type SyncCenterLog } from '@/components/patterns/sync-center';
import type { SyncLog } from '@/features/sync/api/list-org-sync-logs.api';
import { useStoreSyncs } from '@/features/sync/hooks/use-store-syncs';

import { useProductFacets } from '../hooks/use-product-facets';
import { useProducts } from '../hooks/use-products';
import { useProductsFilters } from '../hooks/use-products-filters';
import { useStartProductSync } from '../hooks/use-start-product-sync';

import { ProductsEmptyState } from './products-empty-state';
import { ProductsFilterBar } from './products-filter-bar';
import { ProductsPagination } from './products-pagination';
import { ProductsTable } from './products-table';

interface ProductsPageClientProps {
  orgId: string | null;
  storeId: string | null;
  pageTitle: string;
  pageIntent: string;
}

/**
 * Top-level client component for the products page. Owns:
 *   - URL state (via useProductsFilters / nuqs)
 *   - Server state (via useProducts / useProductFacets — React Query)
 *   - Sync surface (active sync logs via REST + Realtime overlay,
 *     manual trigger via mutation)
 *   - Composition of filter bar + table + pagination + sync center
 */
export function ProductsPageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: ProductsPageClientProps): React.ReactElement {
  const tSync = useTranslations('syncCenter');
  const { filters, setFilters } = useProductsFilters();
  const [syncCenterOpen, setSyncCenterOpen] = React.useState(false);

  const noStoreSelected = orgId === null || storeId === null;

  const productsQuery = useProducts(
    noStoreSelected
      ? null
      : {
          orgId,
          storeId,
          q: filters.q.length > 0 ? filters.q : undefined,
          status: filters.status,
          brandId: filters.brandId.length > 0 ? filters.brandId : undefined,
          categoryId: filters.categoryId.length > 0 ? filters.categoryId : undefined,
          page: filters.page,
          perPage: filters.perPage,
          sort: filters.sort,
        },
  );
  const facetsQuery = useProductFacets(orgId, storeId);
  const { activeSyncs, recentSyncs } = useStoreSyncs(storeId);
  const startSync = useStartProductSync(orgId, storeId);

  if (noStoreSelected) {
    return (
      <>
        <PageHeader title={pageTitle} intent={pageIntent} />
        <ProductsEmptyState variant="no-store" />
      </>
    );
  }

  const data = productsQuery.data?.data ?? [];
  const pagination = productsQuery.data?.pagination ?? {
    page: filters.page,
    perPage: filters.perPage,
    total: 0,
    totalPages: 0,
  };

  const isInitialLoad = productsQuery.isLoading;
  const isEmptyAfterLoad = !isInitialLoad && data.length === 0;
  const hasActiveSearchOrFilter =
    filters.q.length > 0 ||
    filters.status !== 'onSale' ||
    filters.brandId.length > 0 ||
    filters.categoryId.length > 0;

  const productSyncSnapshot = derivedSyncSnapshot(activeSyncs, recentSyncs);
  const syncCenterLogs = toSyncCenterLogs(activeSyncs, recentSyncs);

  return (
    <>
      <div className="gap-lg flex flex-col">
        <PageHeader
          title={pageTitle}
          intent={pageIntent}
          actions={
            <SyncBadge
              state={productSyncSnapshot.state}
              lastSyncedAt={productSyncSnapshot.lastSyncedAt}
              progress={productSyncSnapshot.progress}
              activeCount={activeSyncs.length}
              source="Trendyol"
              onClick={() => setSyncCenterOpen(true)}
              ariaLabel={tSync('openLabel')}
            />
          }
        />

        <ProductsFilterBar
          q={filters.q}
          status={filters.status}
          brandId={filters.brandId}
          categoryId={filters.categoryId}
          onSearchChange={(next) => void setFilters({ q: next })}
          onStatusChange={(next) => void setFilters({ status: next })}
          onBrandChange={(next) => void setFilters({ brandId: next })}
          onCategoryChange={(next) => void setFilters({ categoryId: next })}
          onClearAll={() =>
            void setFilters({
              q: '',
              status: 'onSale',
              brandId: '',
              categoryId: '',
              page: 1,
            })
          }
          facets={facetsQuery.data}
        />

        <ProductsTable
          data={data}
          loading={isInitialLoad}
          empty={
            isEmptyAfterLoad ? (
              <ProductsEmptyState variant={hasActiveSearchOrFilter ? 'filtered' : 'no-products'} />
            ) : undefined
          }
        />

        {pagination.total > 0 ? (
          <ProductsPagination
            page={pagination.page}
            perPage={pagination.perPage}
            total={pagination.total}
            totalPages={pagination.totalPages}
            onPageChange={(next) => void setFilters({ page: next })}
            onPerPageChange={(next) => void setFilters({ perPage: next, page: 1 })}
          />
        ) : null}
      </div>

      <SyncCenter
        open={syncCenterOpen}
        onOpenChange={setSyncCenterOpen}
        logs={syncCenterLogs}
        triggers={[
          {
            syncType: 'PRODUCTS',
            onClick: () => {
              startSync.mutate();
            },
            isPending: startSync.isPending,
          },
        ]}
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
 * Derive the SyncBadge's display state from the active+recent sync
 * logs for the PRODUCTS sync type. The provider already classified
 * rows into active (PENDING / RUNNING / FAILED_RETRYABLE) vs recent
 * (COMPLETED / FAILED), so this is a thin "first PRODUCTS log per
 * bucket wins" projection:
 *
 * - FAILED_RETRYABLE active row → `retrying` state with progress
 *   (sync hit a transient error and is in backoff; user can open
 *   SyncCenter for the error code + retry time)
 * - RUNNING / PENDING active row → `syncing` state with progress
 * - Otherwise: latest finished run sets `lastSyncedAt` and tone
 *   (`failed` for terminal FAILED, `fresh` for COMPLETED or no history).
 */
function derivedSyncSnapshot(activeSyncs: SyncLog[], recentSyncs: SyncLog[]): SyncSnapshot {
  const active = activeSyncs.find((l) => l.syncType === 'PRODUCTS');
  if (active !== undefined) {
    return {
      state: active.status === 'FAILED_RETRYABLE' ? 'retrying' : 'syncing',
      lastSyncedAt: active.startedAt,
      progress: { current: active.progressCurrent, total: active.progressTotal },
    };
  }
  const recent = recentSyncs.find((l) => l.syncType === 'PRODUCTS');
  if (recent === undefined) {
    return { state: 'fresh', lastSyncedAt: null };
  }
  if (recent.status === 'FAILED') {
    return { state: 'failed', lastSyncedAt: recent.completedAt ?? recent.startedAt };
  }
  return { state: 'fresh', lastSyncedAt: recent.completedAt ?? recent.startedAt };
}

/**
 * Project SyncLog rows from the org-wide provider onto the SyncCenterLog
 * shape. SyncCenter and the underlying type now span the full worker
 * pipeline lifecycle (PENDING → RUNNING → FAILED_RETRYABLE → COMPLETED
 * /FAILED), so this is a straightforward field-level mapping with no
 * status filtering. Pulls through `errorMessage`, `attemptCount`, and
 * `nextAttemptAt` so the FAILED_RETRYABLE rendering can show the user
 * what's happening + when the next retry will fire.
 */
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
