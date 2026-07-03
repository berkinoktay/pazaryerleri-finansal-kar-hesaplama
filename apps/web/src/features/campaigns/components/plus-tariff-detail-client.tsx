'use client';

import { ArrowLeft01Icon, Delete02Icon, DownloadCircle01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { parseAsFloat, parseAsString, parseAsStringEnum, useQueryStates } from 'nuqs';
import * as React from 'react';

import { BulkActionBar } from '@/components/patterns/bulk-action-bar';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

import { useDeletePlusTariff } from '../hooks/use-delete-plus-tariff';
import { useExportPlusTariff } from '../hooks/use-export-plus-tariff';
import { usePlusTariffDetail } from '../hooks/use-plus-tariff-detail';
import { useUpdatePlusSelections } from '../hooks/use-update-plus-selections';
import { toPlusTariffView } from '../lib/adapt-plus-tariff';
import { downloadBlob } from '../lib/download-blob';
import {
  clearJoins,
  filterPlusRows,
  joinAll,
  joinProfitable,
  type PlusCustomChoice,
  type PlusCustomPriceMap,
  type PlusSelectionMap,
  type PlusSelectionState,
  type PlusTariffFilterState,
} from '../lib/plus-bulk-actions';
import { summarizePlusSelection } from '../lib/plus-tariff-summary';
import { TariffScopeProvider } from '../lib/tariff-scope';
import { PlusTariffStatusBadge } from './plus-tariff-status-badge';
import { PlusTariffsMobileCards } from './plus-tariffs-mobile-cards';
import { PlusTariffsSummary } from './plus-tariffs-summary';
import { PlusTariffsTable } from './plus-tariffs-table';
import { PlusTariffsToolbar } from './plus-tariffs-toolbar';

const LIST_PATH = '/campaigns/plus-commission-tariffs';

function distinct(values: readonly (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => v !== null)));
}

/**
 * Data-bound DETAIL screen for one saved Plus tariff. Loads it from the backend
 * (with the current + Plus scenario profit already computed per product), lets the
 * seller opt each product in/out of Plus, and persists the choices + downloads the
 * patched Trendyol xlsx on "Kaydet ve Indir". Join choices buffer locally (seeded
 * from the server) then save via PATCH; the breakdown modal + custom-price what-if
 * call the estimate endpoint (scope provided via context). No client-side money
 * math. Unlike the commission tariff there are NO periods — a Plus tariff is a
 * single 7-day window whose products render directly.
 */
export function PlusTariffDetailClient({
  orgId,
  storeId,
  tariffId,
}: {
  orgId: string | null;
  storeId: string | null;
  tariffId: string;
}): React.ReactElement {
  const tPage = useTranslations('plusCommissionTariffsPage');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const detail = usePlusTariffDetail(orgId ?? '', storeId, tariffId);
  const updateSelections = useUpdatePlusSelections(orgId ?? '', storeId ?? '', tariffId);
  const exportTariff = useExportPlusTariff(orgId ?? '', storeId ?? '');
  const deleteTariff = useDeletePlusTariff(orgId ?? '', storeId ?? '');

  const view = React.useMemo(
    () => (detail.data !== undefined ? toPlusTariffView(detail.data) : null),
    [detail.data],
  );

  // Two MUTUALLY EXCLUSIVE per-row join buffers: `selection` = joined at the ceiling
  // price; `customPrices` = joined at a confirmed custom price. A row is in at most
  // one. Both stay local (edit state) and save together on "Kaydet ve İndir".
  const [selection, setSelection] = React.useState<PlusSelectionMap>({});
  const [customPrices, setCustomPrices] = React.useState<PlusCustomPriceMap>({});
  const [seededTariffId, setSeededTariffId] = React.useState<string | null>(null);
  // View state (filters) is URL-owned via nuqs: reload / share / back-forward
  // reproduce the exact view. The tri-states encode 'all' as an absent param;
  // minMargin is a float param. The JOIN buffer below stays local — edit state.
  const [urlState, setUrlState] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      category: parseAsString,
      brand: parseAsString,
      minMargin: parseAsFloat,
      profit: parseAsStringEnum<'profitable' | 'loss'>(['profitable', 'loss']),
      selection: parseAsStringEnum<'selected' | 'unselected'>(['selected', 'unselected']),
    },
    { history: 'push' },
  );
  const filters: PlusTariffFilterState = {
    query: urlState.q,
    category: urlState.category,
    brand: urlState.brand,
    minMarginPct: urlState.minMargin,
    profit: urlState.profit ?? 'all',
    selection: urlState.selection ?? 'all',
  };
  const applyFilters = (next: Partial<PlusTariffFilterState>): void => {
    void setUrlState({
      ...(next.query !== undefined ? { q: next.query } : {}),
      ...(next.category !== undefined ? { category: next.category } : {}),
      ...(next.brand !== undefined ? { brand: next.brand } : {}),
      ...(next.minMarginPct !== undefined ? { minMargin: next.minMarginPct } : {}),
      ...(next.profit !== undefined ? { profit: next.profit === 'all' ? null : next.profit } : {}),
      ...(next.selection !== undefined
        ? { selection: next.selection === 'all' ? null : next.selection }
        : {}),
    });
  };
  const resetFilters = (): void =>
    void setUrlState({
      q: '',
      category: null,
      brand: null,
      minMargin: null,
      profit: null,
      selection: null,
    });

  // Seed the editable join buffer from the server-authoritative `selected` flag the
  // first time this tariff's data arrives. Adjusting state during render (guarded by
  // the tariff id, so it fires once per tariff) is the React-recommended alternative
  // to a setState-in-effect — no cascading renders.
  if (view !== null && view.id !== seededTariffId) {
    const seedSelection: PlusSelectionMap = {};
    const seedCustom: PlusCustomPriceMap = {};
    for (const row of view.rows) {
      if (row.customPrice !== null) {
        // Custom-joined: restore the confirmed price. The custom price's exact
        // profit isn't in the detail payload, so approximate the summary with the
        // ceiling profit until the seller re-confirms (which captures the estimate).
        seedCustom[row.id] = {
          price: row.customPrice,
          netProfit: row.plus.netProfit,
          marginPct: row.plus.marginPct,
        };
      } else if (row.selected) {
        seedSelection[row.id] = true;
      }
    }
    setSelection(seedSelection);
    setCustomPrices(seedCustom);
    setSeededTariffId(view.id);
  }

  const handleToggleJoin = React.useCallback((rowId: string): void => {
    // Joining/leaving at the ceiling; clears any custom price (mutually exclusive).
    setSelection((prev) => ({ ...prev, [rowId]: prev[rowId] !== true }));
    setCustomPrices((prev) => (prev[rowId] == null ? prev : { ...prev, [rowId]: null }));
  }, []);

  const handleSelectCustom = React.useCallback((rowId: string, choice: PlusCustomChoice): void => {
    // A confirmed custom price replaces any ceiling join (mutually exclusive).
    setCustomPrices((prev) => ({ ...prev, [rowId]: choice }));
    setSelection((prev) => (prev[rowId] ? { ...prev, [rowId]: false } : prev));
  }, []);

  const handleDeselectCustom = React.useCallback((rowId: string): void => {
    setCustomPrices((prev) => (prev[rowId] == null ? prev : { ...prev, [rowId]: null }));
  }, []);

  if (detail.isLoading) {
    // Full page-anatomy placeholder (back link + header + 4-cell summary strip +
    // data panel) mirroring the loaded layout below.
    return <PageSkeleton label={tCommon('loading')} withBackLink statCells={4} />;
  }

  // Distinguish a genuine 404 (deleted / cross-tenant — non-disclosure convention
  // says show "not found") from a transient fetch failure (5xx / network — offer a
  // retry, don't imply the tariff is gone). The global onError already toasts.
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

  if (view === null || orgId === null || storeId === null) {
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

  const rows = view.rows;
  const summary = summarizePlusSelection(rows, selection, customPrices);
  const filteredRows = filterPlusRows(rows, selection, customPrices, filters);
  const categories = distinct(rows.map((row) => row.category));
  const brands = distinct(rows.map((row) => row.brand));
  const hasActiveFilters =
    filters.query !== '' ||
    filters.category !== null ||
    filters.brand !== null ||
    filters.minMarginPct !== null ||
    filters.profit !== 'all' ||
    filters.selection !== 'all';

  const applyBulk = (
    fn: (rows: typeof filteredRows, state: PlusSelectionState) => PlusSelectionState,
  ): void => {
    const next = fn(filteredRows, { selection, customPrices });
    setSelection(next.selection);
    setCustomPrices(next.customPrices);
  };

  const onSaveExport = (): void => {
    // A row exports its custom price when custom-joined, else the ceiling when
    // ceiling-joined; `selected` (plusSelected) is true for either.
    const selections = rows.map((row) => {
      const custom = customPrices[row.id];
      return {
        itemId: row.id,
        selected: custom != null || selection[row.id] === true,
        customPrice: custom != null ? custom.price : null,
      };
    });
    updateSelections.mutate(
      { selections },
      {
        onSuccess: () => {
          exportTariff.mutate(tariffId, {
            onSuccess: (blob) => downloadBlob(blob, `${view.name}.xlsx`),
          });
        },
      },
    );
  };

  const toolbar = (
    <PlusTariffsToolbar
      searchValue={filters.query}
      // Per-keystroke q writes REPLACE (no letter-by-letter Back history).
      onSearchChange={(next) => void setUrlState({ q: next }, { history: 'replace' })}
      categories={categories}
      brands={brands}
      filters={filters}
      onFiltersChange={applyFilters}
      onJoinAll={() => applyBulk(joinAll)}
      onJoinProfitable={() => applyBulk(joinProfitable)}
      onClearJoins={() => applyBulk(clearJoins)}
    />
  );

  return (
    <TariffScopeProvider scope={{ orgId, storeId, tariffId }}>
      {/* Reserve space for the floating save bar while products are joined, so the
          last product row scrolls clear of it (esp. on mobile). */}
      <div className={cn('gap-lg flex flex-col', summary.joinedCount > 0 && 'pb-4xl')}>
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
          badge={<PlusTariffStatusBadge validity={view.validity} />}
          intent={view.dateRangeLabel}
          className="gap-lg border-b-0 pb-0"
          actions={
            <ConfirmDialog
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  leadingIcon={<Delete02Icon aria-hidden />}
                  className="text-destructive hover:border-destructive hover:bg-destructive-surface hover:text-destructive"
                >
                  {tPage('templates.delete')}
                </Button>
              }
              title={tPage('templates.deleteTitle')}
              description={tPage('templates.deleteDescription')}
              confirmLabel={tPage('templates.deleteConfirm')}
              onConfirm={() =>
                deleteTariff.mutate(tariffId, { onSuccess: () => router.push(LIST_PATH) })
              }
            />
          }
          summary={<PlusTariffsSummary summary={summary} />}
        />

        <div className="hidden min-w-0 md:block">
          <PlusTariffsTable
            rows={filteredRows}
            selection={selection}
            customPrices={customPrices}
            onToggleJoin={handleToggleJoin}
            onSelectCustom={handleSelectCustom}
            onDeselectCustom={handleDeselectCustom}
            toolbar={toolbar}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={resetFilters}
          />
        </div>
        <div className="gap-sm flex flex-col md:hidden">
          {toolbar}
          <PlusTariffsMobileCards
            rows={filteredRows}
            selection={selection}
            customPrices={customPrices}
            onToggleJoin={handleToggleJoin}
            onSelectCustom={handleSelectCustom}
            onDeselectCustom={handleDeselectCustom}
          />
        </div>

        <BulkActionBar
          selectedCount={summary.joinedCount}
          countLabel={(count) => tPage('actionBar.joined', { count })}
          actions={[
            {
              id: 'save-export',
              label: tPage('actions.saveExport'),
              icon: <DownloadCircle01Icon aria-hidden />,
              onClick: onSaveExport,
              tone: 'primary',
            },
          ]}
        />
      </div>
    </TariffScopeProvider>
  );
}
