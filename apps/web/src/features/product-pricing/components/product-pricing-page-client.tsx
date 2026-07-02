'use client';

import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { useIsMobile } from '@/hooks/use-mobile';

import type { ProductPricingItem } from '../api/list-product-pricing.api';
import {
  useProductPricingFilters,
  PRODUCT_PRICING_DEFAULT_SORT,
} from '../hooks/use-product-pricing-filters';
import { useProductPricingList } from '../hooks/use-product-pricing-list';
import { usePricingFacets } from '../hooks/use-pricing-facets';
import type { ProductPricingSort } from '../query-keys';

import { PricingPanelSheet } from './pricing-panel-sheet';
import { ProductPricingEmptyState } from './product-pricing-empty-state';
import { ProductPricingTable } from './product-pricing-table';
import { ProductPricingToolbar } from './product-pricing-toolbar';

interface ProductPricingPageClientProps {
  orgId: string | null;
  storeId: string | null;
  pageTitle: string;
  pageIntent: string;
}

const SEARCH_DEBOUNCE_MS = 250;

export function ProductPricingPageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: ProductPricingPageClientProps): React.ReactElement {
  const { filters, setFilters } = useProductPricingFilters();
  const isMobile = useIsMobile();
  const noStoreSelected = orgId === null || storeId === null;

  // Mobile pricing-panel target. Desktop uses the table's inline row-expand;
  // this state only drives the mobile Sheet.
  const [panelItem, setPanelItem] = React.useState<ProductPricingItem | null>(null);

  // The search input keeps local state so each keystroke doesn't push a URL
  // update; the URL write is debounced to ~250ms idle. Seeded from the URL
  // once on mount — handleClearFilters resets both layers together. (Margin
  // bounds no longer need this: the chip editor commits explicitly.)
  const [qInput, setQInput] = React.useState(filters.q);

  React.useEffect(() => {
    if (qInput === filters.q) return;
    const handle = window.setTimeout(() => {
      void setFilters({ q: qInput });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [qInput, filters.q, setFilters]);

  const query = useProductPricingList(
    noStoreSelected
      ? null
      : {
          orgId,
          storeId,
          sortBy: filters.sortBy,
          q: filters.q.length > 0 ? filters.q : undefined,
          ...(filters.lossOnly ? { profitStatus: 'loss' as const } : {}),
          marginMin: filters.marginMin.length > 0 ? filters.marginMin : undefined,
          marginMax: filters.marginMax.length > 0 ? filters.marginMax : undefined,
          categoryId: filters.categoryId.length > 0 ? filters.categoryId : undefined,
          brandId: filters.brandId.length > 0 ? filters.brandId : undefined,
          page: filters.page,
          perPage: filters.perPage,
        },
  );
  const facetsQuery = usePricingFacets(orgId, storeId);

  if (noStoreSelected) {
    return (
      <div className="gap-lg flex flex-col">
        <PageHeader title={pageTitle} intent={pageIntent} />
        <ProductPricingEmptyState variant="no-store" />
      </div>
    );
  }

  const result = query.data;
  const rows = result?.data ?? [];
  const total = result?.pagination.total ?? 0;
  const totalPages = result?.pagination.totalPages ?? 0;
  const isInitialLoad = query.isLoading;
  const isError = query.isError && rows.length === 0;

  const hasActiveFilters =
    filters.sortBy !== PRODUCT_PRICING_DEFAULT_SORT ||
    filters.q.length > 0 ||
    filters.lossOnly ||
    filters.marginMin.length > 0 ||
    filters.marginMax.length > 0 ||
    filters.categoryId.length > 0 ||
    filters.brandId.length > 0;

  const handleSortChange = (next: ProductPricingSort): void => {
    void setFilters({ sortBy: next });
  };

  const handlePaginationChange = (next: { page: number; perPage: number }): void => {
    void setFilters({ page: next.page, perPage: next.perPage });
  };

  const handleClearFilters = (): void => {
    setQInput('');
    void setFilters({
      sortBy: PRODUCT_PRICING_DEFAULT_SORT,
      q: '',
      lossOnly: false,
      marginMin: '',
      marginMax: '',
      categoryId: '',
      brandId: '',
    });
  };

  const handleOpenPanel = (item: ProductPricingItem): void => {
    setPanelItem(item);
  };

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader title={pageTitle} intent={pageIntent} />

      <ProductPricingTable
        rows={rows}
        sortBy={filters.sortBy}
        loading={isInitialLoad}
        orgId={orgId}
        storeId={storeId}
        isMobile={isMobile}
        toolbar={(table) => (
          <ProductPricingToolbar
            table={table}
            q={qInput}
            onSearchChange={setQInput}
            params={{
              categoryId: filters.categoryId,
              brandId: filters.brandId,
              marginMin: filters.marginMin,
              marginMax: filters.marginMax,
              lossOnly: filters.lossOnly,
            }}
            onParamsApply={(next) => void setFilters(next)}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={handleClearFilters}
            facets={facetsQuery.data}
          />
        )}
        empty={<ProductPricingEmptyState variant="no-products" />}
        noResultsState={
          <ProductPricingEmptyState variant="no-matches" onClearFilters={handleClearFilters} />
        }
        hasActiveFilters={hasActiveFilters}
        onClearFilters={handleClearFilters}
        error={isError}
        onRetry={() => void query.refetch()}
        onOpenPanel={handleOpenPanel}
        page={filters.page}
        perPage={filters.perPage}
        total={total}
        totalPages={totalPages}
        onPaginationChange={handlePaginationChange}
        onSortChange={handleSortChange}
      />

      {/* Mobile shell only — desktop pricing lives in the table's inline
          row-expand. Passing `null` when not mobile keeps the Sheet closed. */}
      <PricingPanelSheet
        item={isMobile ? panelItem : null}
        orgId={orgId}
        storeId={storeId}
        onClose={() => setPanelItem(null)}
      />
    </div>
  );
}
