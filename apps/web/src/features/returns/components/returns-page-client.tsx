'use client';

import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';

import { useReturns } from '../hooks/use-returns';
import { useReturnsFilters } from '../hooks/use-returns-filters';
import { useReturnsSummary } from '../hooks/use-returns-summary';

import { ReturnsEmptyState } from './returns-empty-state';
import { ReturnsKpiStrip } from './returns-kpi-strip';
import { ReturnsTable } from './returns-table';

interface ReturnsPageClientProps {
  orgId: string | null;
  storeId: string | null;
  pageTitle: string;
  pageIntent: string;
}

/**
 * Top-level client component for the returns page. Owns URL state via
 * useReturnsFilters and server state via useReturns / useReturnsSummary.
 * Read-only V1: data arrives from the 6h CLAIMS sync — no realtime, no
 * refresh action. Mirrors OrdersPageClient composition.
 *
 * The KPI period follows the table's from/to filter; when both are empty
 * the params are OMITTED so the backend applies its own 30-day default
 * (spec §5.2) — the window is never re-derived on the FE.
 */
export function ReturnsPageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: ReturnsPageClientProps): React.ReactElement {
  const { filters, setFilters } = useReturnsFilters();

  const noStoreSelected = orgId === null || storeId === null;

  const returnsQuery = useReturns(
    noStoreSelected
      ? null
      : {
          orgId,
          storeId,
          q: filters.q.length > 0 ? filters.q : undefined,
          status: filters.status === 'all' ? undefined : filters.status,
          from: filters.from.length > 0 ? filters.from : undefined,
          to: filters.to.length > 0 ? filters.to : undefined,
          page: filters.page,
          perPage: filters.perPage,
        },
  );
  const summaryQuery = useReturnsSummary(
    noStoreSelected
      ? null
      : {
          orgId,
          storeId,
          from: filters.from.length > 0 ? filters.from : undefined,
          to: filters.to.length > 0 ? filters.to : undefined,
        },
  );

  if (noStoreSelected) {
    return (
      <>
        <PageHeader title={pageTitle} intent={pageIntent} />
        <ReturnsEmptyState variant="no-store" />
      </>
    );
  }

  const rows = returnsQuery.data?.data ?? [];
  const pagination = returnsQuery.data?.pagination ?? {
    page: filters.page,
    perPage: filters.perPage,
    total: 0,
    totalPages: 0,
  };
  const counts = returnsQuery.data?.counts ?? { all: 0, open: 0, resolved: 0 };

  const hasAnyFilter = filters.q.length > 0 || filters.from.length > 0 || filters.to.length > 0;

  // Genuine first-run empty (no claims at all, no filter narrowing): show the
  // sync-cadence explainer instead of an empty grid. With filters active the
  // DataTable's own no-results state carries the clear-filters affordance.
  if (!returnsQuery.isLoading && !hasAnyFilter && counts.all === 0) {
    return (
      <>
        <PageHeader title={pageTitle} intent={pageIntent} />
        <ReturnsEmptyState variant="no-returns" />
      </>
    );
  }

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader title={pageTitle} intent={pageIntent} />
      <ReturnsKpiStrip
        summary={summaryQuery.data}
        loading={summaryQuery.isPending}
        error={summaryQuery.isError}
      />
      <ReturnsTable
        rows={rows}
        loading={returnsQuery.isLoading}
        pagination={pagination}
        filters={{ q: filters.q, from: filters.from, to: filters.to }}
        status={filters.status}
        counts={counts}
        tabsLoading={returnsQuery.isLoading}
        onStatusChange={(next) => setFilters({ status: next })}
        onFiltersChange={(next) =>
          setFilters({
            ...(next.q !== undefined ? { q: next.q } : {}),
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
  );
}
