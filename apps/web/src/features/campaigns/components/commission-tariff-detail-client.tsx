'use client';

import { ArrowLeft01Icon, Delete02Icon, DownloadCircle01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { parseAsFloat, parseAsString, parseAsStringEnum, useQueryStates } from 'nuqs';
import * as React from 'react';

import { BulkActionBar } from '@/components/patterns/bulk-action-bar';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { EmptyState } from '@/components/patterns/empty-state';
import { FilterTabs } from '@/components/patterns/filter-tabs';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

import { useCommissionTariffDetail } from '../hooks/use-commission-tariff-detail';
import { useDeleteTariff } from '../hooks/use-delete-tariff';
import { useExportTariff } from '../hooks/use-export-tariff';
import { useUpdateSelections } from '../hooks/use-update-selections';
import { asBandKey } from '../lib/band-key';
import {
  clearSelections,
  filterRows,
  selectBestForAll,
  selectByTargetMargin,
  selectProfitableOnly,
  type SelectionMap,
  type TargetStrategy,
  type TariffFilterState,
} from '../lib/bulk-actions';
import { toDetailTemplate } from '../lib/adapt-tariff';
import { summarizeSelection } from '../lib/commission-tariff-summary';
import { downloadBlob } from '../lib/download-blob';
import { TariffScopeProvider } from '../lib/tariff-scope';
import { CommissionTariffStatusBadge } from './commission-tariff-status-badge';
import { CommissionTariffsMobileCards } from './commission-tariffs-mobile-cards';
import { CommissionTariffsSummary } from './commission-tariffs-summary';
import { CommissionTariffsTable } from './commission-tariffs-table';
import { CommissionTariffsToolbar } from './commission-tariffs-toolbar';

const LIST_PATH = '/campaigns/product-commission-tariffs';

function distinct(values: readonly (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => v !== null)));
}

/**
 * Data-bound DETAIL screen for one saved tariff. Loads it from the backend (with
 * per-band profit already computed), lets the seller toggle a band per product,
 * and persists the choices + downloads the patched Trendyol xlsx on "Kaydet ve
 * İndir". Band selections buffer locally (seeded from the server) then save via
 * PATCH; the breakdown modal + custom-price what-if call the estimate endpoint
 * (scope provided via context). No client-side money math.
 */
export function CommissionTariffDetailClient({
  orgId,
  storeId,
  tariffId,
}: {
  orgId: string | null;
  storeId: string | null;
  tariffId: string;
}): React.ReactElement {
  const tPage = useTranslations('commissionTariffsPage');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const detail = useCommissionTariffDetail(orgId ?? '', storeId, tariffId);
  const updateSelections = useUpdateSelections(orgId ?? '', storeId ?? '', tariffId);
  const exportTariff = useExportTariff(orgId ?? '', storeId ?? '');
  const deleteTariff = useDeleteTariff(orgId ?? '', storeId ?? '');

  const template = React.useMemo(
    () => (detail.data !== undefined ? toDetailTemplate(detail.data) : null),
    [detail.data],
  );

  const [selection, setSelection] = React.useState<SelectionMap>({});
  const [seededTariffId, setSeededTariffId] = React.useState<string | null>(null);
  // View state (filters + active period tab) is URL-owned via nuqs: reload /
  // share / back-forward reproduce the exact view. The tri-states encode
  // 'all' as an absent param; minMargin is a float param. The SELECTION
  // buffer below stays local — it is edit state, not view state.
  const [urlState, setUrlState] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      category: parseAsString,
      brand: parseAsString,
      minMargin: parseAsFloat,
      profit: parseAsStringEnum<'profitable' | 'loss'>(['profitable', 'loss']),
      selection: parseAsStringEnum<'selected' | 'unselected'>(['selected', 'unselected']),
      period: parseAsString,
    },
    { history: 'push' },
  );
  const periodId = urlState.period;
  const setPeriodId = (next: string): void => void setUrlState({ period: next });
  const filters: TariffFilterState = {
    query: urlState.q,
    category: urlState.category,
    brand: urlState.brand,
    minMarginPct: urlState.minMargin,
    profit: urlState.profit ?? 'all',
    selection: urlState.selection ?? 'all',
  };
  const applyFilters = (next: Partial<TariffFilterState>): void => {
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

  // Seed the editable selection buffer from the server-authoritative
  // `selectedBand` the first time this tariff's data arrives. Adjusting state
  // during render (guarded by the tariff id, so it fires once per tariff) is the
  // React-recommended alternative to a setState-in-effect — no cascading renders.
  if (template !== null && template.id !== seededTariffId) {
    const seed: SelectionMap = {};
    for (const period of template.periods) {
      for (const row of period.rows) {
        if (row.selectedBand !== null) seed[row.id] = row.selectedBand;
      }
    }
    setSelection(seed);
    setSeededTariffId(template.id);
  }

  const handleSelectBand = React.useCallback((rowId: string, band: string): void => {
    setSelection((prev) => ({ ...prev, [rowId]: prev[rowId] === band ? null : band }));
  }, []);

  if (detail.isLoading) {
    // Full page-anatomy placeholder (back link + header + 4-cell summary strip
    // + data panel) mirroring the loaded layout below.
    return <PageSkeleton label={tCommon('loading')} withBackLink statCells={4} />;
  }

  // Distinguish a genuine 404 (deleted / cross-tenant — non-disclosure convention
  // says show "not found") from a transient fetch failure (5xx / network — offer
  // a retry, don't imply the tariff is gone). The global onError already toasts.
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

  if (template === null || orgId === null || storeId === null) {
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

  const periods = template.periods;
  const activePeriod = periods.find((period) => period.id === periodId) ?? periods[0] ?? null;
  if (activePeriod === null) {
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

  const periodRows = activePeriod.rows;
  const summary = summarizeSelection(periodRows, selection);
  const filteredRows = filterRows(periodRows, selection, filters);
  const categories = distinct(periodRows.map((row) => row.category));
  const brands = distinct(periodRows.map((row) => row.brand));
  const hasActiveFilters =
    filters.query !== '' ||
    filters.category !== null ||
    filters.brand !== null ||
    filters.minMarginPct !== null ||
    filters.profit !== 'all' ||
    filters.selection !== 'all';

  const applyBulk = (fn: (rows: typeof filteredRows, prev: SelectionMap) => SelectionMap): void => {
    setSelection((prev) => fn(filteredRows, prev));
  };
  const onTargetMargin = (targetPct: number, strategy: TargetStrategy): void => {
    setSelection((prev) => selectByTargetMargin(filteredRows, prev, targetPct, strategy));
  };

  const onSaveExport = (): void => {
    const allRows = periods.flatMap((period) => period.rows);
    const selections = allRows.map((row) => ({
      itemId: row.id,
      band: asBandKey(selection[row.id] ?? null) ?? null,
      customPrice: row.customPrice,
    }));
    updateSelections.mutate(
      { selections },
      {
        onSuccess: () => {
          exportTariff.mutate(tariffId, {
            onSuccess: (blob) => downloadBlob(blob, `${template.name}.xlsx`),
          });
        },
      },
    );
  };

  const periodTabs =
    periods.length > 1 ? (
      <FilterTabs
        value={activePeriod.id}
        onValueChange={(next) => setPeriodId(next)}
        options={periods.map((period) => ({ value: period.id, label: period.dateRangeLabel }))}
      />
    ) : null;

  const toolbar = (
    <CommissionTariffsToolbar
      searchValue={filters.query}
      // Per-keystroke q writes REPLACE (no letter-by-letter Back history).
      onSearchChange={(next) => void setUrlState({ q: next }, { history: 'replace' })}
      categories={categories}
      brands={brands}
      filters={filters}
      onFiltersChange={applyFilters}
      onBestAll={() => applyBulk(selectBestForAll)}
      onProfitableOnly={() => applyBulk(selectProfitableOnly)}
      onTargetMargin={onTargetMargin}
      onClearSelections={() => applyBulk(clearSelections)}
    />
  );

  return (
    <TariffScopeProvider scope={{ orgId, storeId, tariffId }}>
      {/* Reserve space for the floating save bar while a band is selected, so the
          last product row scrolls clear of it (esp. on mobile). */}
      <div className={cn('gap-lg flex flex-col', summary.selectedCount > 0 && 'pb-4xl')}>
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
          title={template.name}
          badge={<CommissionTariffStatusBadge validity={activePeriod.validity} />}
          intent={activePeriod.dateRangeLabel}
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
          summary={<CommissionTariffsSummary summary={summary} />}
        />

        <div className="hidden min-w-0 md:block">
          <CommissionTariffsTable
            rows={filteredRows}
            selection={selection}
            onSelectBand={handleSelectBand}
            tabs={periodTabs}
            toolbar={toolbar}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={resetFilters}
          />
        </div>
        <div className="gap-sm flex flex-col md:hidden">
          {periodTabs}
          {toolbar}
          <CommissionTariffsMobileCards
            rows={filteredRows}
            selection={selection}
            onSelectBand={handleSelectBand}
          />
        </div>

        <BulkActionBar
          selectedCount={summary.selectedCount}
          countLabel={(count) => tPage('actionBar.selectedBands', { count })}
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
