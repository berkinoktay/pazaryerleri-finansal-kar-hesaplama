'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/patterns/page-header';
import { TableErrorState, TableNoResultsState } from '@/components/patterns/data-table-states';

import {
  useProductPricingFilters,
  PRODUCT_PRICING_DEFAULT_SORT,
  PRODUCT_PRICING_PER_PAGE_OPTIONS,
  type ProductPricingView,
} from '../hooks/use-product-pricing-filters';
import { useProductPricingList } from '../hooks/use-product-pricing-list';
import type { ProductPricingSort } from '../query-keys';

import { PricingPaginationFooter } from './pricing-pagination-footer';
import { ProductPricingCards } from './product-pricing-cards';
import { ProductPricingEmptyState } from './product-pricing-empty-state';
import { ProductPricingTable } from './product-pricing-table';
import { ProductPricingViewToggle } from './product-pricing-view-toggle';

interface ProductPricingPageClientProps {
  orgId: string | null;
  storeId: string | null;
  pageTitle: string;
  pageIntent: string;
}

export function ProductPricingPageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: ProductPricingPageClientProps): React.ReactElement {
  const t = useTranslations('features.productPricing');
  const { filters, setFilters } = useProductPricingFilters();
  const noStoreSelected = orgId === null || storeId === null;

  const query = useProductPricingList(
    noStoreSelected
      ? null
      : {
          orgId,
          storeId,
          sortBy: filters.sortBy,
          page: filters.page,
          perPage: filters.perPage,
        },
  );

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

  // Skeleton has no search/filter toolbar yet — the only "active" state is
  // a non-default sort, which the no-matches reset clears back to default.
  const hasActiveFilters = filters.sortBy !== PRODUCT_PRICING_DEFAULT_SORT;

  const handleSortChange = (next: ProductPricingSort): void => {
    void setFilters({ sortBy: next });
  };

  const handleViewChange = (next: ProductPricingView): void => {
    void setFilters({ view: next });
  };

  const handlePaginationChange = (next: { page: number; perPage: number }): void => {
    void setFilters({ page: next.page, perPage: next.perPage });
  };

  const handleClearFilters = (): void => {
    void setFilters({ sortBy: PRODUCT_PRICING_DEFAULT_SORT });
  };

  const handlePriceRow = (_variantId: string): void => {
    // Pricing panel ships in a later slice; the variantId is already in
    // hand for when it does. For now, signal "coming soon".
    toast.info(t('action.comingSoon'));
  };

  // Zero-row state shared by both views: error → no-results (filtered) →
  // first-run empty. The table renders these in its own body; the cards view
  // consumes the same nodes so the page reads consistently across views.
  const cardsZeroState = isError ? (
    <TableErrorState onRetry={() => void query.refetch()} />
  ) : hasActiveFilters ? (
    <TableNoResultsState onClearFilters={handleClearFilters} />
  ) : (
    <ProductPricingEmptyState variant="no-products" />
  );

  const showCards = filters.view === 'cards';
  // The shared pagination footer mounts for cards only once there are rows to
  // page through (the table keeps its own footer inside the DataTable shell).
  const showCardsPagination = showCards && !isInitialLoad && !isError && rows.length > 0;

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader
        title={pageTitle}
        intent={pageIntent}
        actions={<ProductPricingViewToggle view={filters.view} onViewChange={handleViewChange} />}
      />

      {showCards ? (
        <ProductPricingCards
          rows={rows}
          loading={isInitialLoad}
          state={cardsZeroState}
          onPriceRow={handlePriceRow}
        />
      ) : (
        <ProductPricingTable
          rows={rows}
          sortBy={filters.sortBy}
          loading={isInitialLoad}
          empty={<ProductPricingEmptyState variant="no-products" />}
          noResultsState={
            <ProductPricingEmptyState variant="no-matches" onClearFilters={handleClearFilters} />
          }
          hasActiveFilters={hasActiveFilters}
          onClearFilters={handleClearFilters}
          error={isError}
          onRetry={() => void query.refetch()}
          onPriceRow={handlePriceRow}
          page={filters.page}
          perPage={filters.perPage}
          total={total}
          totalPages={totalPages}
          onPaginationChange={handlePaginationChange}
          onSortChange={handleSortChange}
        />
      )}

      {showCardsPagination ? (
        <PricingPaginationFooter
          rows={rows}
          page={filters.page}
          perPage={filters.perPage}
          total={total}
          totalPages={totalPages}
          pageSizes={PRODUCT_PRICING_PER_PAGE_OPTIONS}
          onPaginationChange={handlePaginationChange}
        />
      ) : null}
    </div>
  );
}
