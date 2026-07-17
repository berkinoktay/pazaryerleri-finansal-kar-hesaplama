'use client';

import { ArrowLeft01Icon, Delete02Icon, DownloadCircle01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { parseAsBoolean, parseAsString, useQueryStates } from 'nuqs';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api-error';

import { useDeleteDiscountList } from '../hooks/use-delete-discount-list';
import { useDiscountListDetail } from '../hooks/use-discount-list-detail';
import { useEstimateDiscountItem } from '../hooks/use-estimate-discount-item';
import { useExportDiscountList } from '../hooks/use-export-discount-list';
import { useUpdateDiscountSelections } from '../hooks/use-update-discount-selections';
import { toDiscountListView, type DiscountRow } from '../lib/adapt-discount-list';
import {
  filterDiscountRows,
  hasActiveDiscountFilters,
  profitableSelections,
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
 * recomputes every discounted scenario), pick which products to include, and download the patched
 * Trendyol xlsx. Selection is EPHEMERAL client state — a local `Set<itemId>` that starts EMPTY on
 * every mount (the backend `included` flag is ignored on read). Checkbox toggles and smart-select
 * only mutate that Set; nothing persists until the seller clicks "Kaydet ve İndir", which first
 * flushes the full selection to the backend (mode 'set' over every row) and, on success, streams
 * the export download. There is no client-side money math (the profit badges/delta only render
 * backend figures). The breakdown modal calls the estimate endpoint for the clicked scenario.
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

  // Selection is EPHEMERAL: a local set of included itemIds that starts EMPTY on every mount and is
  // NEVER seeded from the backend `included` flag. The checkbox reads/writes this only; nothing
  // hits the network until "Kaydet ve İndir" flushes the whole set (see onSaveAndDownload).
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(() => new Set());

  // View state (search + the three filter chips) is URL-owned via nuqs: reload / share /
  // back-forward reproduce the exact view. Each chip is a boolean param that drops from the URL
  // at its default (false) and q drops when empty, so a clean view leaves no query string. The
  // breakdown modal + config-edit dialog stay LOCAL — transient edit state, not a shareable view.
  const [urlState, setUrlState] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      profitable: parseAsBoolean.withDefault(false),
      losing: parseAsBoolean.withDefault(false),
    },
    { history: 'push' },
  );
  const [breakdown, setBreakdown] = React.useState<BreakdownState | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);

  // Derive the DiscountFilterState the toolbar + filterDiscountRows consume. Memoized on the raw
  // params so its identity stays stable across unrelated renders — keeps the filteredRows memo
  // below from recomputing (a fresh object each render would defeat it).
  const filters = React.useMemo<DiscountFilterState>(
    () => ({
      query: urlState.q,
      profitable: urlState.profitable,
      losing: urlState.losing,
    }),
    [urlState.q, urlState.profitable, urlState.losing],
  );

  const applyFilters = (next: Partial<DiscountFilterState>): void => {
    const patch = {
      ...(next.query !== undefined ? { q: next.query } : {}),
      ...(next.profitable !== undefined ? { profitable: next.profitable } : {}),
      ...(next.losing !== undefined ? { losing: next.losing } : {}),
    };
    // Per-keystroke search writes REPLACE (no letter-by-letter Back history); chip toggles PUSH.
    if (next.query !== undefined) {
      void setUrlState(patch, { history: 'replace' });
      return;
    }
    void setUrlState(patch);
  };
  const resetFilters = (): void => void setUrlState({ q: '', profitable: false, losing: false });

  // Stable handlers for the table `columns` — a single-row toggle and the breakdown opener never
  // change identity, so `columns` never rebuilds. The toggle now only mutates LOCAL state (no
  // network); the functional update keeps it dependency-free and thus identity-stable.
  const onToggleInclude = React.useCallback((itemId: string, included: boolean): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (included) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }, []);
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

  // No store selected: the detail query is disabled and every action needs a store, so show a
  // store-selection state instead of the misleading "not found". Mirrors the list screen's guard.
  if (orgId === null || storeId === null) {
    return (
      <EmptyState
        title={tPage('noStore.title')}
        description={tPage('noStore.description')}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/stores">{tPage('noStore.cta')}</Link>
          </Button>
        }
      />
    );
  }

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

  if (view === null || list === null) {
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

  const itemCount = view.rows.length;
  const selectedCount = selectedIds.size;
  const hasFilters = hasActiveDiscountFilters(filters);
  const exportDisabled = selectedCount === 0;
  // Both steps of "Kaydet ve İndir" (flush → download) share one loading state.
  const savePending = selectionsPending || exportList.isPending;

  // All three smart-selects drive the LOCAL set — no network. "Tümünü seç" adds every row id,
  // "Temizle" clears, "Kârda kalanları seç" applies the exclusive profitable projection over the
  // VISIBLE rows only (hidden rows keep their current selection, mirroring the old mode 'set').
  const onSelectAll = (): void => setSelectedIds(new Set(view.rows.map((row) => row.id)));
  const onClearSelections = (): void => setSelectedIds(new Set());
  const onSelectProfitable = (): void =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const { itemId, included } of profitableSelections(filteredRows)) {
        if (included) next.add(itemId);
        else next.delete(itemId);
      }
      return next;
    });

  // "Kaydet ve İndir": flush the FULL local selection (mode 'set' over every row, so the DB
  // fully mirrors local state and any stale prior flush is cleared), THEN — only on flush
  // success — stream the export download. A flush failure aborts before download; the global
  // error pipeline already toasts, so no local onError.
  const onSaveAndDownload = (): void => {
    const selections = view.rows.map((row) => ({
      itemId: row.id,
      included: selectedIds.has(row.id),
    }));
    mutateSelections(
      { mode: 'set', selections },
      {
        onSuccess: () => {
          exportList.mutate(listId, {
            // Filename comes from the server; fall back to the list name if the header was absent.
            onSuccess: (file) => downloadBlob(file.blob, file.filename ?? `${view.name}.xlsx`),
          });
        },
      },
    );
  };

  const toolbar = (
    <DiscountItemsToolbar
      filters={filters}
      onFiltersChange={applyFilters}
      onSelectAll={onSelectAll}
      onSelectProfitable={onSelectProfitable}
      onClearSelections={onClearSelections}
      selectionsPending={savePending}
      selectedCount={selectedCount}
    />
  );

  const exportButton = (
    <Button
      size="sm"
      onClick={onSaveAndDownload}
      disabled={exportDisabled}
      loading={savePending}
      leadingIcon={<DownloadCircle01Icon aria-hidden />}
    >
      {tActions('saveAndDownload')}
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
        summary={<DiscountItemsSummary itemCount={itemCount} selectedCount={selectedCount} />}
      />

      <DiscountConfigCard list={list} onEdit={() => setEditOpen(true)} />

      <div className="hidden min-w-0 md:block">
        <DiscountItemsTable
          rows={filteredRows}
          selectedIds={selectedIds}
          commissionTariffName={view.commissionTariffName}
          commissionPeriodLabel={view.commissionPeriodLabel}
          selectionsPending={savePending}
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
          selectedIds={selectedIds}
          commissionTariffName={view.commissionTariffName}
          commissionPeriodLabel={view.commissionPeriodLabel}
          selectionsPending={savePending}
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
