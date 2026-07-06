'use client';

import { Time04Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { FilterTabs } from '@/components/patterns/filter-tabs';
import { PageHeader } from '@/components/patterns/page-header';
import { TimeAgo } from '@/components/patterns/time-ago';

import { useCommissionRates } from '../hooks/use-commission-rates';
import { useCommissionRatesFilters } from '../hooks/use-commission-rates-filters';
import type {
  CommissionRateProductScope,
  CommissionRateRuleKind,
  CommissionRateSort,
} from '../query-keys';

import { CommissionRatesEmptyState } from './commission-rates-empty-state';
import { CommissionRatesTable } from './commission-rates-table';
import { CommissionRatesToolbar } from './commission-rates-toolbar';

interface CommissionRatesPageClientProps {
  orgId: string | null;
  storeId: string | null;
  pageTitle: string;
  pageIntent: string;
}

const SEARCH_DEBOUNCE_MS = 250;

export function CommissionRatesPageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: CommissionRatesPageClientProps): React.ReactElement {
  const t = useTranslations('features.commissionRates');
  const { filters, setFilters } = useCommissionRatesFilters();
  const noStoreSelected = orgId === null || storeId === null;

  // Search input has its own local state so each keystroke doesn't push
  // a URL update; we debounce the URL write to ~250ms idle. The local
  // state is only seeded from URL once on mount — handleClearFilters
  // resets both layers in a single transition for the in-app reset path,
  // and we accept that browser back/forward won't repaint the draft
  // value (acceptable v1 trade-off for filter pages).
  const [qInput, setQInput] = React.useState(filters.q);

  React.useEffect(() => {
    if (qInput === filters.q) return;
    const handle = window.setTimeout(() => {
      void setFilters({ q: qInput });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [qInput, filters.q, setFilters]);

  const query = useCommissionRates(
    noStoreSelected
      ? null
      : {
          orgId,
          storeId,
          ruleKind: filters.ruleKind,
          productScope: filters.productScope,
          q: filters.q.length > 0 ? filters.q : undefined,
          sort: filters.sort,
          page: filters.page,
          perPage: filters.perPage,
        },
  );

  if (noStoreSelected) {
    return (
      <div className="gap-lg flex flex-col">
        <PageHeader variant="framed" title={pageTitle} intent={pageIntent} />
        <CommissionRatesEmptyState variant="no-store" />
      </div>
    );
  }

  const result = query.data;
  const rows = result?.data ?? [];
  const total = result?.pagination.total ?? 0;
  const totalPages = result?.pagination.totalPages ?? 0;
  const isInitialLoad = query.isLoading;

  const hasActiveFilter = filters.q.length > 0 || filters.productScope === 'active';
  // The tariff's import freshness — every row shares the same fetchedAt
  // (platform-global reference data), so the first row is representative.
  const tariffFetchedAt = rows[0]?.fetchedAt;

  const handleRuleKindChange = (next: CommissionRateRuleKind): void => {
    void setFilters({ ruleKind: next });
  };

  const handleProductScopeChange = (next: CommissionRateProductScope): void => {
    // Don't auto-flip an existing 'product_count:desc' sort back to
    // default when the user is just toggling scope — instead, drop sort
    // back to the safe default if the invariant breaks.
    const sortBecomesInvalid = next === 'all' && filters.sort === 'product_count:desc';
    void setFilters({
      productScope: next,
      ...(sortBecomesInvalid ? { sort: 'category_name:asc' as CommissionRateSort } : {}),
    });
  };

  const handleSortChange = (intent: {
    sort: CommissionRateSort;
    productScope: CommissionRateProductScope;
    autoSwitchedScope: boolean;
  }): void => {
    void setFilters({ sort: intent.sort, productScope: intent.productScope });
    if (intent.autoSwitchedScope) {
      toast.info(t('autoSwitchedToActive'));
    }
  };

  const handlePaginationChange = (next: { page: number; perPage: number }): void => {
    void setFilters({ page: next.page, perPage: next.perPage });
  };

  const handleClearFilters = (): void => {
    setQInput('');
    void setFilters({ q: '', productScope: 'all' });
  };

  const ruleKindTabs = (
    <FilterTabs<CommissionRateRuleKind>
      value={filters.ruleKind}
      onValueChange={handleRuleKindChange}
      aria-label={t('tabs.ruleKindLabel')}
      options={[
        { value: 'CATEGORY', label: t('tabs.category') },
        { value: 'CATEGORY_BRAND', label: t('tabs.categoryBrand') },
      ]}
    />
  );

  const freshnessMeta =
    tariffFetchedAt !== undefined ? (
      <span className="text-2xs text-muted-foreground gap-2xs inline-flex items-center">
        <Time04Icon className="size-icon-xs" aria-hidden />
        <span>{t('meta.tariffUpdated')}</span>
        <span aria-hidden className="text-muted-foreground-dim">
          ·
        </span>
        <TimeAgo value={tariffFetchedAt} className="text-foreground" />
      </span>
    ) : undefined;

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader variant="framed" title={pageTitle} intent={pageIntent} meta={freshnessMeta} />

      <CommissionRatesTable
        rows={rows}
        ruleKind={filters.ruleKind}
        productScope={filters.productScope}
        sort={filters.sort}
        loading={isInitialLoad}
        tabs={ruleKindTabs}
        toolbar={
          <CommissionRatesToolbar
            q={qInput}
            onSearchChange={setQInput}
            productScope={filters.productScope}
            onProductScopeChange={handleProductScopeChange}
          />
        }
        empty={<CommissionRatesEmptyState variant="no-rates" />}
        noResultsState={
          <CommissionRatesEmptyState variant="no-matches" onClearFilters={handleClearFilters} />
        }
        hasActiveFilters={hasActiveFilter}
        onClearFilters={handleClearFilters}
        error={query.isError && rows.length === 0}
        onRetry={() => void query.refetch()}
        page={filters.page}
        perPage={filters.perPage}
        total={total}
        totalPages={totalPages}
        onPaginationChange={handlePaginationChange}
        onSortChange={handleSortChange}
      />
    </div>
  );
}
