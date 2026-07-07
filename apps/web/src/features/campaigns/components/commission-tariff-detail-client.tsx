'use client';

import { ArrowLeft01Icon, Delete02Icon, DownloadCircle01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { parseAsFloat, parseAsString, parseAsStringEnum, useQueryStates } from 'nuqs';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api-error';

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
  type CommissionSelectionState,
  type CustomChoice,
  type CustomPriceMap,
  type SelectionMap,
  type TargetStrategy,
  type TariffFilterState,
} from '../lib/bulk-actions';
import { toDetailTemplate } from '../lib/adapt-tariff';
import { findBand, summarizeSelection } from '../lib/commission-tariff-summary';
import { downloadBlob } from '../lib/download-blob';
import { TariffScopeProvider } from '../lib/tariff-scope';
import { computeExportPreview } from '../lib/whole-week';
import { CommissionTariffStatusBadge, STATUS_TONE } from './commission-tariff-status-badge';
import { CommissionTariffsMobileCards } from './commission-tariffs-mobile-cards';
import { CommissionTariffsSummary } from './commission-tariffs-summary';
import { CommissionTariffsTable } from './commission-tariffs-table';
import { CommissionTariffsToolbar } from './commission-tariffs-toolbar';
import { ExportTariffDialog } from './export-tariff-dialog';
import { PeriodTabs } from './period-tabs';

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
  const tExport = useTranslations('commissionTariffsPage.exportDialog');
  const router = useRouter();
  const detail = useCommissionTariffDetail(orgId ?? '', storeId, tariffId);
  const updateSelections = useUpdateSelections(orgId ?? '', storeId ?? '', tariffId);
  const exportTariff = useExportTariff(orgId ?? '', storeId ?? '');
  const deleteTariff = useDeleteTariff(orgId ?? '', storeId ?? '');

  const template = React.useMemo(
    () => (detail.data !== undefined ? toDetailTemplate(detail.data) : null),
    [detail.data],
  );

  // `selection` = the chosen band per row; `customPrices` = the optional custom
  // amount overriding that band's boundary price. Choosing a band clears the row's
  // custom price; committing a custom price sets both. Both stay local (edit state)
  // and save together on "Kaydet ve İndir".
  //
  // They live in ONE state object so the select/deselect handlers below can be
  // identity-stable `useCallback([])`: a functional `setChoices((prev) => …)` reads
  // BOTH maps from `prev`, so no handler needs `customPrices` in its deps. A stable
  // handler identity is what keeps the table's `columns` from rebuilding — rebuilding
  // remounts every cell (flexRender renders each `cell:` as a component) and wipes a
  // half-typed custom price. See commission-tariffs-table.tsx.
  const [choices, setChoices] = React.useState<CommissionSelectionState>({
    selection: {},
    customPrices: {},
  });
  const { selection, customPrices } = choices;
  // UNCOMMITTED live what-if profit per row (the figure the custom-price card shows
  // while the seller is still typing). It exists ONLY to let the "En kârlı" badge race
  // the live estimate before "Bu fiyatı seç" — it never feeds export or the summary.
  const [customEstimates, setCustomEstimates] = React.useState<Record<string, string | null>>({});
  // Uncommitted "what-if" draft prices per row, kept in a REF so they survive the cell
  // unmounting: the DataTable unmounts off-page rows on pagination, and a filter / tab
  // switch unmounts the whole set. Without this store a half-typed, NOT-yet-committed
  // draft is lost on remount — a committed price re-seeds from `customPrices`, but an
  // uncommitted one has no copy anywhere else. Map semantics: NO key = never touched (the
  // cell falls back to its committed / server seed), value `null` = the seller
  // deliberately cleared it (stay empty), a string = the draft price. It is a ref, not
  // state, because the draft must NOT drive renders — the "En kârlı" marker already tracks
  // the live figure through `customEstimates`. Making it state would re-render the whole
  // table on every keystroke; a ref costs nothing and is read only at a cell's mount.
  const customDraftsRef = React.useRef(new Map<string, string | null>());
  const getCustomDraft = React.useCallback(
    (rowId: string): string | null | undefined => customDraftsRef.current.get(rowId),
    [],
  );
  const handleCustomDraftChange = React.useCallback((rowId: string, price: string | null): void => {
    customDraftsRef.current.set(rowId, price);
  }, []);
  const [exportOpen, setExportOpen] = React.useState(false);
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
    const seedCustom: CustomPriceMap = {};
    for (const period of template.periods) {
      for (const row of period.rows) {
        if (row.selectedBand === null) continue;
        seed[row.id] = row.selectedBand;
        if (row.customPrice !== null) {
          // Custom-priced: restore the confirmed amount. Its exact profit isn't in
          // the detail payload, so approximate the summary with the derived band's
          // profit until the seller re-confirms (which captures the estimate).
          const band = findBand(row, row.selectedBand);
          seedCustom[row.id] = {
            price: row.customPrice,
            netProfit: band?.netProfit ?? null,
            marginPct: band?.marginPct ?? null,
          };
        }
      }
    }
    setChoices({ selection: seed, customPrices: seedCustom });
    setSeededTariffId(template.id);
  }

  const handleSelectBand = React.useCallback((rowId: string, band: string): void => {
    // Toggle off only when re-clicking the PLAIN boundary selection; when a custom
    // price is active, clicking a band replaces it (never toggles off). Either way,
    // choosing a band clears the row's custom price — a row has one choice. Both maps
    // are read from `prev` so the handler needs no deps (stable identity).
    setChoices((prev) => {
      const isBoundarySelected = prev.selection[rowId] === band && prev.customPrices[rowId] == null;
      return {
        selection: { ...prev.selection, [rowId]: isBoundarySelected ? null : band },
        customPrices:
          prev.customPrices[rowId] == null
            ? prev.customPrices
            : { ...prev.customPrices, [rowId]: null },
      };
    });
  }, []);

  const handleSelectCustom = React.useCallback(
    (rowId: string, band: string, choice: CustomChoice): void => {
      // A confirmed custom price sets both the derived band and the amount.
      setChoices((prev) => ({
        selection: { ...prev.selection, [rowId]: band },
        customPrices: { ...prev.customPrices, [rowId]: choice },
      }));
    },
    [],
  );

  const handleDeselectCustom = React.useCallback((rowId: string): void => {
    // Un-committing a custom price clears the whole row choice (the band was only
    // there because of the custom price).
    setChoices((prev) => ({
      selection:
        prev.selection[rowId] == null ? prev.selection : { ...prev.selection, [rowId]: null },
      customPrices:
        prev.customPrices[rowId] == null
          ? prev.customPrices
          : { ...prev.customPrices, [rowId]: null },
    }));
  }, []);

  const handleCustomEstimate = React.useCallback(
    (rowId: string, netProfit: string | null): void => {
      // Identity guard — the debounced estimate often resolves to the same figure; skip
      // the state update (and the re-render) when nothing actually changed.
      setCustomEstimates((prev) =>
        prev[rowId] === netProfit ? prev : { ...prev, [rowId]: netProfit },
      );
    },
    [],
  );

  if (detail.isLoading) {
    // Full page-anatomy placeholder (back link + header + 4-cell summary strip
    // + data panel) mirroring the loaded layout below.
    return <PageSkeleton label={tCommon('loading')} withBackLink statCells={4} framed />;
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
  const summary = summarizeSelection(periodRows, selection, customPrices);
  // The floating save/export bar is GLOBAL: one click saves + downloads every window
  // file (3/4/7-günlük) across ALL sub-periods, so its count spans all periods — not
  // just the active tab (whose per-period figures the summary strip already shows).
  const globalSelectedCount = periods.reduce(
    (total, period) => total + period.rows.filter((row) => selection[row.id] != null).length,
    0,
  );
  // Which window files (3/4/7-günlük) the export will produce + their product counts —
  // the pre-download preview shown in the export dialog. Mirrors the backend bucketing.
  const previewFiles = computeExportPreview(periods, selection, customPrices);
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

  const applyBulk = (
    fn: (rows: typeof filteredRows, state: CommissionSelectionState) => CommissionSelectionState,
  ): void => {
    setChoices((prev) => fn(filteredRows, prev));
  };
  const onTargetMargin = (targetPct: number, strategy: TargetStrategy): void => {
    setChoices((prev) => selectByTargetMargin(filteredRows, prev, targetPct, strategy));
  };

  const onSaveExport = (): void => {
    const allRows = periods.flatMap((period) => period.rows);
    const selections = allRows.map((row) => ({
      itemId: row.id,
      band: asBandKey(selection[row.id] ?? null) ?? null,
      // The locally-edited custom price overrides the persisted one; null when the
      // row's choice is a plain band.
      customPrice: customPrices[row.id]?.price ?? null,
    }));
    updateSelections.mutate(
      { selections },
      {
        onSuccess: () => {
          exportTariff.mutate(tariffId, {
            // Filename comes from the server (a split week downloads a `.zip`); fall
            // back to the tariff name only if the header was absent.
            onSuccess: (file) => {
              downloadBlob(file.blob, file.filename ?? `${template.name}.xlsx`);
              setExportOpen(false);
            },
          });
        },
      },
    );
  };
  const periodTabs =
    periods.length > 1 ? (
      <PeriodTabs
        value={activePeriod.id}
        onValueChange={setPeriodId}
        aria-label={tPage('periodsAriaLabel')}
        options={periods.map((period) => ({
          value: period.id,
          // Bold "3 Gün" / "4 Gün" line + the date range as a muted sub-line, so the
          // sub-period (the decision axis) and its validity read at a glance.
          dayLabel:
            period.dayCount !== null
              ? tPage('periodDayLabel', { count: period.dayCount })
              : period.dateRangeLabel,
          rangeLabel: period.dayCount !== null ? period.dateRangeLabel : '',
          tone: STATUS_TONE[period.validity ?? 'draft'],
        }))}
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
          title={template.name}
          badge={<CommissionTariffStatusBadge validity={activePeriod.validity} />}
          intent={activePeriod.dateRangeLabel}
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
                  deleteTariff.mutate(tariffId, { onSuccess: () => router.push(LIST_PATH) })
                }
              />
              {/* Fixed export button (replaces the floating bar): opens a preview modal
                  of which window files will download before the seller confirms. */}
              <Button
                size="sm"
                onClick={() => setExportOpen(true)}
                disabled={globalSelectedCount === 0}
                leadingIcon={<DownloadCircle01Icon aria-hidden />}
              >
                {tPage('actions.export')}
              </Button>
            </div>
          }
          summary={<CommissionTariffsSummary summary={summary} />}
        />

        <div className="hidden min-w-0 md:block">
          <CommissionTariffsTable
            rows={filteredRows}
            selection={selection}
            customPrices={customPrices}
            customEstimates={customEstimates}
            onSelectBand={handleSelectBand}
            onSelectCustom={handleSelectCustom}
            onDeselectCustom={handleDeselectCustom}
            onCustomEstimate={handleCustomEstimate}
            getCustomDraft={getCustomDraft}
            onCustomDraftChange={handleCustomDraftChange}
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
            customPrices={customPrices}
            customEstimates={customEstimates}
            onSelectBand={handleSelectBand}
            onSelectCustom={handleSelectCustom}
            onDeselectCustom={handleDeselectCustom}
            onCustomEstimate={handleCustomEstimate}
            getCustomDraft={getCustomDraft}
            onCustomDraftChange={handleCustomDraftChange}
          />
        </div>

        <ExportTariffDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          files={previewFiles}
          labels={{
            title: tExport('title'),
            description: tExport('description'),
            fileName: (days) => tExport('fileName', { days }),
            productCount: (count) => tExport('productCount', { count }),
            zipNote: (count) => tExport('zipNote', { count }),
            cancel: tExport('cancel'),
            download: tExport('download'),
            saving: tExport('saving'),
            exporting: tExport('exporting'),
          }}
          // Two-phase: selections PATCH first, then the file downloads — so the
          // dialog can say which is happening ("kaydediliyor…" → "indiriliyor…").
          isSaving={updateSelections.isPending}
          isDownloading={exportTariff.isPending}
          onConfirm={onSaveExport}
        />
      </div>
    </TariffScopeProvider>
  );
}
