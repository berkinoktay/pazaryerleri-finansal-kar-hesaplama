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
import { ProductsTable } from './products-table';
import { ProductsTabStrip, type ProductsOverrideTab } from './products-tab-strip';

interface ProductsPageClientProps {
  orgId: string | null;
  storeId: string | null;
  pageTitle: string;
  pageIntent: string;
}

/**
 * Top-level client component for the products page. Owns:
 *   - URL state (via useProductsFilters / nuqs) — q, status, brand,
 *     category, overrideMissing, page, perPage, sort.
 *   - Server state (via useProducts / useProductFacets — React Query).
 *   - Sync surface (active sync logs via REST + Realtime overlay,
 *     manual trigger via mutation).
 *   - Composition of header + tab strip + table + sync center.
 *
 * The toolbar (search input + facet chips) and pagination footer are
 * mounted inside ProductsTable's render-prop slots so the table-bordered
 * card frames the whole control surface visually.
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
          overrideMissing: filters.overrideMissing ?? undefined,
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

  const tabValue: ProductsOverrideTab = filters.overrideMissing ?? 'all';
  // Tab-aware empty-state variant. Per spec §6.3: missing-cost / missing-vat
  // tabs that come back empty read as "you're all set" rather than the
  // generic "no products match the filter" copy.
  const emptyVariant = ((): ProductsEmptyVariant | undefined => {
    if (!isEmptyAfterLoad) return undefined;
    if (filters.overrideMissing === 'cost') return 'missing-cost-none';
    if (filters.overrideMissing === 'vat') return 'missing-vat-none';
    if (hasActiveSearchOrFilter) return 'filtered';
    return 'no-products';
  })();

  return (
    <>
      <div className="gap-lg flex flex-col">
        <PageHeader
          title={pageTitle}
          intent={pageIntent}
          meta={
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

        <ProductsTabStrip
          value={tabValue}
          counts={facetsQuery.data?.overrideCounts}
          loading={facetsQuery.isLoading}
          onChange={(next) =>
            void setFilters({
              overrideMissing: next === 'all' ? null : next,
              page: 1,
            })
          }
        />

        <ProductsTable
          data={data}
          loading={isInitialLoad}
          empty={
            emptyVariant !== undefined ? <ProductsEmptyState variant={emptyVariant} /> : undefined
          }
          pagination={pagination}
          q={filters.q}
          status={filters.status}
          brandId={filters.brandId}
          categoryId={filters.categoryId}
          overrideMissing={filters.overrideMissing}
          sort={filters.sort}
          facets={facetsQuery.data}
          onSearchChange={(next) => void setFilters({ q: next, page: 1 })}
          onStatusChange={(next) => void setFilters({ status: next, page: 1 })}
          onBrandChange={(next) => void setFilters({ brandId: next, page: 1 })}
          onCategoryChange={(next) => void setFilters({ categoryId: next, page: 1 })}
          onSortChange={(next) => void setFilters({ sort: next })}
          onPageChange={(next) => void setFilters({ page: next })}
          onPerPageChange={(next) => void setFilters({ perPage: next, page: 1 })}
        />
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

type ProductsEmptyVariant =
  | 'no-store'
  | 'no-products'
  | 'filtered'
  | 'missing-cost-none'
  | 'missing-vat-none';

interface SyncSnapshot {
  state: SyncState;
  lastSyncedAt: Date | string | null;
  progress?: { current: number; total: number | null };
}

/**
 * Derive the SyncBadge's display state from the active+recent sync
 * logs for the PRODUCTS sync type. Provider already classifies rows
 * into active (PENDING / RUNNING / FAILED_RETRYABLE) vs recent
 * (COMPLETED / FAILED), so this is a thin "first PRODUCTS log per
 * bucket wins" projection.
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
