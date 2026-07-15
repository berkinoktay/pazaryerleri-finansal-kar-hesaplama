'use client';

import { ArrowLeft01Icon, Delete02Icon, DownloadCircle01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api-error';

import { useDeleteDiscountList } from '../hooks/use-delete-discount-list';
import { useDiscountListDetail } from '../hooks/use-discount-list-detail';
import { useEstimateDiscountItem } from '../hooks/use-estimate-discount-item';
import { useExportDiscountList } from '../hooks/use-export-discount-list';
import { useUpdateDiscountSelections } from '../hooks/use-update-discount-selections';
import { toDiscountListView, type DiscountRow } from '../lib/adapt-discount-list';
import {
  EMPTY_DISCOUNT_FILTERS,
  filterDiscountRows,
  hasActiveDiscountFilters,
  profitableRowIds,
  type DiscountFilterState,
} from '../lib/discount-selection';
import { downloadBlob } from '../lib/download-blob';
import { DiscountBreakdown } from './discount-breakdown';
import { DiscountConfigCard } from './discount-config-card';
import { DiscountConfigEditDialog } from './discount-config-edit-dialog';
import { DiscountItemsMobileCards } from './discount-items-mobile-cards';
import { DiscountItemsSummary } from './discount-items-summary';
import { DiscountItemsTable, type DiscountScenarioKey } from './discount-items-table';
import { DiscountItemsToolbar } from './discount-items-toolbar';

const LIST_PATH = '/campaigns/discounts';

interface BreakdownState {
  row: DiscountRow;
  scenario: DiscountScenarioKey;
}

/**
 * Data-bound DETAIL screen for one saved İndirimler upload. Loads it from the backend (current +
 * discounted profit already computed per row), lets the seller edit the discount kurgu (which
 * recomputes every discounted scenario), pick which products to include (persisted per row), and
 * download the patched Trendyol xlsx. Selection is server-authoritative — each checkbox toggle
 * and each smart-select persists immediately; there is no local buffer and no client-side money
 * math (the profit badges/delta only render backend figures). The breakdown modal calls the
 * estimate endpoint for the clicked scenario.
 */
export function DiscountDetailClient({
  orgId,
  storeId,
  listId,
}: {
  orgId: string | null;
  storeId: string | null;
  listId: string;
}): React.ReactElement {
  const tPage = useTranslations('discountsPage');
  const tActions = useTranslations('discountsPage.actions');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const detail = useDiscountListDetail(orgId ?? '', storeId, listId);
  const updateSelections = useUpdateDiscountSelections(orgId ?? '', storeId ?? '', listId);
  const exportList = useExportDiscountList(orgId ?? '', storeId ?? '');
  const deleteList = useDeleteDiscountList(orgId ?? '', storeId ?? '');
  const estimate = useEstimateDiscountItem(orgId ?? '', storeId ?? '', listId);

  const { mutate: mutateSelections, isPending: selectionsPending } = updateSelections;
  const { mutate: estimateMutate, data: estimateData, isPending: estimatePending } = estimate;

  const list = detail.data ?? null;
  const view = React.useMemo(() => (list !== null ? toDiscountListView(list) : null), [list]);

  const [filters, setFilters] = React.useState<DiscountFilterState>(EMPTY_DISCOUNT_FILTERS);
  const [breakdown, setBreakdown] = React.useState<BreakdownState | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);

  const applyFilters = React.useCallback((next: Partial<DiscountFilterState>): void => {
    setFilters((prev) => ({ ...prev, ...next }));
  }, []);
  const resetFilters = React.useCallback((): void => setFilters(EMPTY_DISCOUNT_FILTERS), []);

  // Stable handlers for the table `columns` — a single-row toggle and the breakdown opener never
  // change identity (the mutate fns are React-Query-stable), so `columns` never rebuilds.
  const onToggleInclude = React.useCallback(
    (itemId: string, included: boolean): void => {
      mutateSelections({ mode: 'set', selections: [{ itemId, included }] });
    },
    [mutateSelections],
  );
  const openBreakdown = React.useCallback(
    (row: DiscountRow, scenario: DiscountScenarioKey): void => {
      setBreakdown({ row, scenario });
      estimateMutate({ itemId: row.id, body: { scenario } });
    },
    [estimateMutate],
  );

  // filterDiscountRows builds a Decimal per row for its profit sign checks, so recompute only when
  // the row set or the active filters change — not on every unrelated render (e.g. a breakdown open).
  const filteredRows = React.useMemo(
    () => (view !== null ? filterDiscountRows(view.rows, filters) : []),
    [view, filters],
  );

  if (detail.isLoading) {
    return <PageSkeleton label={tCommon('loading')} withBackLink statCells={5} framed />;
  }

  // Distinguish a genuine 404 (deleted / cross-tenant → "not found") from a transient fetch
  // failure (5xx / network → offer a retry). The global onError already toasts.
  if (detail.isError) {
    const notFound = detail.error instanceof ApiError && detail.error.code === 'NOT_FOUND';
    return (
      <EmptyState
        title={notFound ? tPage('templates.notFoundTitle') : tCommon('stat.loadError')}
        description={notFound ? tPage('templates.notFoundDescription') : undefined}
        action={
          notFound ? (
            <Button variant="outline" size="sm" onClick={() => router.push(LIST_PATH)}>
              {tPage('templates.back')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
              {tCommon('stat.retry')}
            </Button>
          )
        }
      />
    );
  }

  if (view === null || list === null || orgId === null || storeId === null) {
    return (
      <EmptyState
        title={tPage('templates.notFoundTitle')}
        description={tPage('templates.notFoundDescription')}
        action={
          <Button variant="outline" size="sm" onClick={() => router.push(LIST_PATH)}>
            {tPage('templates.back')}
          </Button>
        }
      />
    );
  }

  const summary = view.summary;
  const hasFilters = hasActiveDiscountFilters(filters);
  const exportDisabled = summary.selectedCount === 0;

  const onSelectAll = (): void => mutateSelections({ mode: 'all', selections: [] });
  const onClearSelections = (): void => mutateSelections({ mode: 'none', selections: [] });
  const onSelectProfitable = (): void =>
    mutateSelections({
      mode: 'set',
      selections: profitableRowIds(filteredRows).map((itemId) => ({ itemId, included: true })),
    });

  const onExport = (): void => {
    exportList.mutate(listId, {
      // Filename comes from the server; fall back to the list name only if the header was absent.
      onSuccess: (file) => downloadBlob(file.blob, file.filename ?? `${view.name}.xlsx`),
    });
  };

  const toolbar = (
    <DiscountItemsToolbar
      filters={filters}
      onFiltersChange={applyFilters}
      onSelectAll={onSelectAll}
      onSelectProfitable={onSelectProfitable}
      onClearSelections={onClearSelections}
      selectionsPending={selectionsPending}
      selectedCount={summary.selectedCount}
    />
  );

  const exportButton = (
    <Button
      size="sm"
      onClick={onExport}
      disabled={exportDisabled}
      loading={exportList.isPending}
      leadingIcon={<DownloadCircle01Icon aria-hidden />}
    >
      {tActions('export')}
    </Button>
  );

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader
        leading={
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(LIST_PATH)}
            leadingIcon={<ArrowLeft01Icon aria-hidden />}
          >
            {tPage('templates.back')}
          </Button>
        }
        title={view.name}
        intent={tPage('templates.detailIntent')}
        variant="framed"
        actions={
          <div className="gap-sm flex items-center">
            <ConfirmDialog
              trigger={
                <Button
                  variant="destructive-ghost"
                  size="sm"
                  leadingIcon={<Delete02Icon aria-hidden />}
                >
                  {tPage('templates.delete')}
                </Button>
              }
              title={tPage('templates.deleteTitle')}
              description={tPage('templates.deleteDescription')}
              confirmLabel={tPage('templates.deleteConfirm')}
              onConfirm={() =>
                deleteList.mutate(listId, { onSuccess: () => router.push(LIST_PATH) })
              }
            />
            {/* Export needs at least one included product; a disabled button can't emit hover, so
                the tooltip wraps a focusable span that explains why. */}
            {exportDisabled ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>{exportButton}</span>
                </TooltipTrigger>
                <TooltipContent>{tActions('exportEmptyHint')}</TooltipContent>
              </Tooltip>
            ) : (
              exportButton
            )}
          </div>
        }
        summary={<DiscountItemsSummary summary={summary} />}
      />

      <DiscountConfigCard list={list} onEdit={() => setEditOpen(true)} />

      <div className="hidden min-w-0 md:block">
        <DiscountItemsTable
          rows={filteredRows}
          selectionsPending={selectionsPending}
          onToggleInclude={onToggleInclude}
          onOpenBreakdown={openBreakdown}
          toolbar={toolbar}
          hasActiveFilters={hasFilters}
          onClearFilters={resetFilters}
        />
      </div>
      <div className="gap-sm flex flex-col md:hidden">
        {toolbar}
        <DiscountItemsMobileCards
          rows={filteredRows}
          selectionsPending={selectionsPending}
          onToggleInclude={onToggleInclude}
          onOpenBreakdown={openBreakdown}
        />
      </div>

      <DiscountBreakdown
        open={breakdown !== null}
        onOpenChange={(next) => {
          if (!next) setBreakdown(null);
        }}
        productTitle={breakdown?.row.productTitle ?? ''}
        imageUrl={breakdown?.row.imageUrl}
        stockCode={breakdown?.row.barcode}
        result={estimateData ?? null}
        loading={estimatePending}
        currentNetProfit={breakdown?.row.current.netProfit ?? null}
      />

      {editOpen ? (
        <DiscountConfigEditDialog
          open
          onOpenChange={(next) => {
            if (!next) setEditOpen(false);
          }}
          orgId={orgId}
          storeId={storeId}
          listId={listId}
          list={list}
        />
      ) : null}
    </div>
  );
}
