'use client';

import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';

import { useProductFacets } from '../hooks/use-product-facets';
import { useProducts } from '../hooks/use-products';
import { useProductsFilters } from '../hooks/use-products-filters';

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
 *   - Composition of filter bar + table + pagination
 *
 * The server component above (page.tsx) reads the active org + store
 * from cookies and passes them in. When either is null we render the
 * "no store" empty state — this is the only path through which the
 * page handles "no store connected", so the rest of the component
 * tree can assume both ids are present.
 */
export function ProductsPageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: ProductsPageClientProps): React.ReactElement {
  const { filters, setFilters } = useProductsFilters();

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

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader title={pageTitle} intent={pageIntent} />

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
  );
}
