'use client';

import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { SyncCenter } from '@/components/patterns/sync-center';
import { PageSyncControl } from '@/features/sync/components/page-sync-control';
import { PageSyncFooterTrace } from '@/features/sync/components/page-sync-footer-trace';
import { useStoreSyncs } from '@/features/sync/hooks/use-store-syncs';
import { toSyncCenterLogs } from '@/features/sync/lib/derive-sync-snapshot';

import { useProductFacets } from '../hooks/use-product-facets';
import { useProductFilterFields } from '../hooks/use-product-filter-fields';
import { useProducts } from '../hooks/use-products';
import { useProductsFilters } from '../hooks/use-products-filters';
import { useRefreshProducts } from '../hooks/use-refresh-products';
import { aggregateMissingShipping } from '../lib/aggregate-missing-shipping';
import { filterRowsToProductParams } from '../lib/products-filter-fields';

import { MissingCostWarningBanner } from './missing-cost-warning-banner';
import { MissingShippingBanner } from './missing-shipping-banner';
import { ProductsEmptyState } from './products-empty-state';
import { ProductsSummary } from './products-summary';
import { ProductsTable } from './products-table';
import { type ProductsOverrideTab } from './products-tab-strip';

interface ProductsPageClientProps {
  orgId: string | null;
  storeId: string | null;
  pageTitle: string;
  pageIntent: string;
}

/**
 * Top-level client component for the products page. Owns:
 *   - URL state (via useProductsFilters / nuqs) — q, filters (FilterRow[]
 *     carrying status/brand/category and the range dimensions),
 *     overrideMissing, productId, page, perPage, sort.
 *   - Server state (via useProducts / useProductFacets — React Query).
 *   - Sync surface (active sync logs via REST + Realtime overlay). Freshness
 *     and the manual PRODUCTS trigger live in the header's PageSyncControl; the
 *     SyncCenter sheet is a history-only surface here.
 *   - Composition of header + tab strip + table + sync center.
 *
 * The toolbar (search input + the advancedFilter add-button/chip row) and
 * pagination footer are mounted inside ProductsTable's render-prop slots so
 * the table-bordered card frames the whole control surface visually.
 */
export function ProductsPageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: ProductsPageClientProps): React.ReactElement {
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
          // Default view scope: on-sale products. A status chip in the
          // advanced filters overrides it via the spread below.
          status: 'onSale',
          productId: filters.productId.length > 0 ? filters.productId : undefined,
          overrideMissing: filters.overrideMissing ?? undefined,
          // Advanced Filtering chips (FilterRow[]) → query params — since the
          // facet chips retired, this carries brand/category/status too.
          ...filterRowsToProductParams(filters.filters),
          page: filters.page,
          perPage: filters.perPage,
          sort: filters.sort,
        },
  );
  const facetsQuery = useProductFacets(orgId, storeId);
  const { activeSyncs, recentSyncs } = useStoreSyncs(storeId);
  const filterFields = useProductFilterFields(facetsQuery.data);
  const refresh = useRefreshProducts(orgId, storeId);

  if (noStoreSelected) {
    return (
      <>
        <PageHeader variant="framed" title={pageTitle} intent={pageIntent} />
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

  // Aggregate per-page non-OK shipping estimates for the banner.
  // Computed in render — `aggregateMissingShipping` is O(n) over the
  // page's variants (≤ perPage products × variants), well within
  // render budget. Memoizing was considered and rejected: React's
  // reference-equality on `data` already short-circuits when the
  // upstream query result is identical.
  const shippingCounts = aggregateMissingShipping(data);

  const isInitialLoad = productsQuery.isLoading;
  const isEmptyAfterLoad = !isInitialLoad && data.length === 0;
  // Advanced-filter chips are the single filter system now (search aside) —
  // status/brand/category all live inside filters.filters.
  const hasActiveSearchOrFilter = filters.q.length > 0 || filters.filters.length > 0;

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
          variant="framed"
          title={pageTitle}
          intent={pageIntent}
          summary={
            // Drop the summary strip only when the facets query errored AND no
            // prior data is cached; a stale-but-present count set keeps rendering
            // (React Query retains last success), so a background-refetch error
            // never leaves the strip stuck in an aria-busy skeleton.
            facetsQuery.isError && facetsQuery.data === undefined ? undefined : (
              <ProductsSummary counts={facetsQuery.data?.overrideCounts} />
            )
          }
          // Controls row: the unified PageSyncControl owns freshness + the manual
          // PRODUCTS sync trigger + the source breakdown popover. onFlowsSettled
          // invalidates the list + facet caches when a products-page sync
          // completes (there was never a standalone "Yenile" button here).
          actions={
            <PageSyncControl
              pageKey="products"
              onOpenHistory={() => setSyncCenterOpen(true)}
              onFlowsSettled={() => refresh.mutate()}
            />
          }
        />

        <MissingCostWarningBanner
          orgId={orgId}
          storeId={storeId}
          onFilterClick={() => void setFilters({ overrideMissing: 'cost', page: 1 })}
        />

        <MissingShippingBanner
          counts={shippingCounts}
          // V1: the API has no `shippingEstimateStatus=NOT_OK` query
          // parameter yet — the dedicated filter ships in V2. For now
          // the CTA scrolls the table into view so the seller can
          // immediately scan the non-OK rows (the yellow/red icons
          // make each one easy to spot on a fresh page).
          onFilterApply={() => {
            if (typeof window !== 'undefined') {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
        />

        <ProductsTable
          orgId={orgId}
          storeId={storeId}
          data={data}
          loading={isInitialLoad}
          paginationLeading={<PageSyncFooterTrace pageKey="products" />}
          empty={
            emptyVariant !== undefined ? (
              <ProductsEmptyState
                variant={emptyVariant}
                onClearFilters={() => void setFilters({ q: '', filters: [], page: 1 })}
              />
            ) : undefined
          }
          pagination={pagination}
          q={filters.q}
          overrideMissing={filters.overrideMissing}
          sort={filters.sort}
          filterFields={filterFields}
          filterRows={filters.filters}
          onFiltersApply={(rows) => void setFilters({ filters: rows, page: 1 })}
          overrideTab={tabValue}
          overrideCounts={facetsQuery.data?.overrideCounts}
          facetsLoading={facetsQuery.isLoading}
          onOverrideTabChange={(next) =>
            void setFilters({
              overrideMissing: next === 'all' ? null : next,
              page: 1,
            })
          }
          onSearchChange={(next) => void setFilters({ q: next, page: 1 })}
          onSortChange={(next) => void setFilters({ sort: next })}
          onPageChange={(next) => void setFilters({ page: next })}
          onPerPageChange={(next) => void setFilters({ perPage: next, page: 1 })}
        />
      </div>

      <SyncCenter
        open={syncCenterOpen}
        onOpenChange={setSyncCenterOpen}
        logs={syncCenterLogs}
        // History-only surface: the manual PRODUCTS trigger lives solely in the
        // header's PageSyncControl (single source of truth), matching the
        // orders/returns pages. Duplicating it here raced the shared cooldown.
        triggers={[]}
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
