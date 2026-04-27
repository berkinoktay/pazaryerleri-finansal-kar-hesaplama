'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { SyncBadge, type SyncState } from '@/components/patterns/sync-badge';
import { SyncCenter, type SyncCenterLog } from '@/components/patterns/sync-center';

import type { SyncLog } from '../api/list-active-sync-logs.api';
import { useActiveSyncLogs } from '../hooks/use-active-sync-logs';
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
  const syncLogsQuery = useActiveSyncLogs(orgId, storeId);
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

  const syncLogs = syncLogsQuery.data ?? [];
  const productSyncSnapshot = derivedSyncSnapshot(syncLogs);

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
        logs={syncLogs as SyncCenterLog[]}
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
 * logs for the PRODUCTS sync type. The newest matching log dictates
 * the badge — newest RUNNING wins; otherwise the latest finished run
 * sets `lastSyncedAt` and tone.
 */
function derivedSyncSnapshot(logs: SyncLog[]): SyncSnapshot {
  const productLogs = logs.filter((l) => l.syncType === 'PRODUCTS');
  const running = productLogs.find((l) => l.status === 'RUNNING');
  if (running !== undefined) {
    return {
      state: 'syncing',
      lastSyncedAt: running.startedAt,
      progress: { current: running.progressCurrent, total: running.progressTotal },
    };
  }
  const finished = productLogs.find((l) => l.status === 'COMPLETED' || l.status === 'FAILED');
  if (finished === undefined) {
    return { state: 'fresh', lastSyncedAt: null };
  }
  if (finished.status === 'FAILED') {
    return { state: 'failed', lastSyncedAt: finished.completedAt ?? finished.startedAt };
  }
  return { state: 'fresh', lastSyncedAt: finished.completedAt ?? finished.startedAt };
}
