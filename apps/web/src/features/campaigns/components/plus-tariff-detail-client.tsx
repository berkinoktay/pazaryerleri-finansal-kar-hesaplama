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

import { useDeletePlusTariff } from '../hooks/use-delete-plus-tariff';
import { useExportPlusTariff } from '../hooks/use-export-plus-tariff';
import { usePlusTariffDetail } from '../hooks/use-plus-tariff-detail';
import { useUpdatePlusSelections } from '../hooks/use-update-plus-selections';
import { toPlusTariffView } from '../lib/adapt-plus-tariff';
import { downloadBlob } from '../lib/download-blob';
import {
  clearJoins,
  filterPlusRows,
  isJoinedRow,
  joinProfitable,
  selectBestForAll,
  type PlusCustomChoice,
  type PlusCustomPriceMap,
  type PlusSelectionMap,
  type PlusSelectionState,
  type PlusTariffFilterState,
} from '../lib/plus-bulk-actions';
import { summarizePlusSelection } from '../lib/plus-tariff-summary';
import { TariffScopeProvider } from '../lib/tariff-scope';
import { computeExportPreview } from '../lib/whole-week';
import { ExportTariffDialog } from './export-tariff-dialog';
import { PeriodTabs } from './period-tabs';
import { PlusTariffStatusBadge, STATUS_TONE } from './plus-tariff-status-badge';
import { PlusTariffsMobileCards } from './plus-tariffs-mobile-cards';
import { PlusTariffsSummary } from './plus-tariffs-summary';
import { PlusTariffsTable } from './plus-tariffs-table';
import { PlusTariffsToolbar } from './plus-tariffs-toolbar';

const LIST_PATH = '/campaigns/plus-commission-tariffs';

function distinct(values: readonly (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => v !== null)));
}

/**
 * Data-bound DETAIL screen for one saved Plus tariff. Loads it from the backend (with
 * the current + Plus offer profit already computed per product), lets the seller opt
 * each product into Plus (at the ceiling or a custom price), and persists the choices +
 * downloads the patched Trendyol xlsx on "Kaydet ve İndir". Join choices buffer locally
 * (seeded from the server) then save via PATCH; the breakdown modal + custom-price
 * what-if call the estimate endpoint (scope provided via context). No client-side money
 * math. Mirrors the commission tariff detail one-to-one — the domain difference is a
 * SINGLE Plus offer per row instead of four price bands.
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
  const tExport = useTranslations('plusCommissionTariffsPage.exportDialog');
  const router = useRouter();
  const detail = usePlusTariffDetail(orgId ?? '', storeId, tariffId);
  const updateSelections = useUpdatePlusSelections(orgId ?? '', storeId ?? '', tariffId);
  const exportTariff = useExportPlusTariff(orgId ?? '', storeId ?? '');
  const deleteTariff = useDeletePlusTariff(orgId ?? '', storeId ?? '');

  const view = React.useMemo(
    () => (detail.data !== undefined ? toPlusTariffView(detail.data) : null),
    [detail.data],
  );

  // `selection` = the ceiling join per row ('plus'); `customPrices` = the optional
  // custom amount joined instead of the ceiling. The two are MUTUALLY EXCLUSIVE per row.
  // Both stay local (edit state) and save together on "Kaydet ve İndir".
  //
  // They live in ONE state object so the join/deselect handlers below can be
  // identity-stable `useCallback([])`: a functional `setChoices((prev) => …)` reads BOTH
  // maps from `prev`, so no handler needs `customPrices` in its deps. A stable handler
  // identity is what keeps the table's `columns` from rebuilding — rebuilding remounts
  // every cell (flexRender renders each `cell:` as a component) and wipes a half-typed
  // custom price. See plus-tariffs-table.tsx.
  const [choices, setChoices] = React.useState<PlusSelectionState>({
    selection: {},
    customPrices: {},
  });
  const { selection, customPrices } = choices;
  // UNCOMMITTED live what-if profit per row (the figure the custom-price card shows while
  // the seller is still typing). It exists ONLY to let the "En kârlı" badge race the live
  // estimate before "Bu fiyatla katıl" — it never feeds export or the summary.
  const [customEstimates, setCustomEstimates] = React.useState<Record<string, string | null>>({});
  // Uncommitted "what-if" draft prices per row, kept in a REF so they survive the cell
  // unmounting (pagination / filter / tab switch). Map semantics: NO key = never touched
  // (fall back to committed / server seed), value `null` = the seller deliberately cleared
  // it (stay empty), a string = the draft price. A ref, not state, because the draft must
  // NOT drive renders — the "En kârlı" marker already tracks the live figure through
  // `customEstimates`.
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
  // View state (filters + active period tab) is URL-owned via nuqs: reload / share /
  // back-forward reproduce the exact view. The tri-states encode 'all' as an absent
  // param; minMargin is a float param. The JOIN buffer below stays local — edit state.
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

  // Seed the editable join buffer from the server-authoritative `selected` flag +
  // `customPrice` the first time this tariff's data arrives. Adjusting state during
  // render (guarded by the tariff id, so it fires once per tariff) is the
  // React-recommended alternative to a setState-in-effect — no cascading renders.
  if (view !== null && view.id !== seededTariffId) {
    const seedSelection: PlusSelectionMap = {};
    const seedCustom: PlusCustomPriceMap = {};
    for (const period of view.periods) {
      for (const row of period.rows) {
        if (row.customPrice !== null) {
          // Custom-joined: restore the confirmed price. Its exact profit isn't in the
          // detail payload, so approximate the summary with the offer's profit until the
          // seller re-confirms (which captures the estimate).
          const offer = row.bands[0];
          seedCustom[row.id] = {
            price: row.customPrice,
            netProfit: offer?.netProfit ?? null,
            marginPct: offer?.marginPct ?? null,
          };
        } else if (row.selected) {
          seedSelection[row.id] = 'plus';
        }
      }
    }
    setChoices({ selection: seedSelection, customPrices: seedCustom });
    setSeededTariffId(view.id);
  }

  const handleToggleJoin = React.useCallback((rowId: string): void => {
    // Toggle off only when re-clicking the PLAIN ceiling join; when a custom price is
    // active, clicking the offer replaces it (never toggles off). Either way, joining at
    // the ceiling clears the row's custom price — a row has one join. Both maps are read
    // from `prev` so the handler needs no deps (stable identity).
    setChoices((prev) => {
      const isCeilingJoined = prev.selection[rowId] === 'plus' && prev.customPrices[rowId] == null;
      return {
        selection: { ...prev.selection, [rowId]: isCeilingJoined ? null : 'plus' },
        customPrices:
          prev.customPrices[rowId] == null
            ? prev.customPrices
            : { ...prev.customPrices, [rowId]: null },
      };
    });
  }, []);

  const handleSelectCustom = React.useCallback((rowId: string, choice: PlusCustomChoice): void => {
    // A confirmed custom price joins Plus at that amount and clears any ceiling join
    // (mutually exclusive).
    setChoices((prev) => ({
      selection:
        prev.selection[rowId] == null ? prev.selection : { ...prev.selection, [rowId]: null },
      customPrices: { ...prev.customPrices, [rowId]: choice },
    }));
  }, []);

  const handleDeselectCustom = React.useCallback((rowId: string): void => {
    // Un-committing a custom price un-joins the row entirely (it was only joined because
    // of the custom price).
    setChoices((prev) => ({
      selection: prev.selection,
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
    // Full page-anatomy placeholder (back link + header + 4-cell summary strip + data
    // panel) mirroring the loaded layout below.
    return <PageSkeleton label={tCommon('loading')} withBackLink statCells={4} framed />;
  }

  // Distinguish a genuine 404 (deleted / cross-tenant — non-disclosure convention says
  // show "not found") from a transient fetch failure (5xx / network — offer a retry,
  // don't imply the tariff is gone). The global onError already toasts.
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

  const periods = view.periods;
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
  const summary = summarizePlusSelection(periodRows, selection, customPrices);
  // The export button is GLOBAL: one confirm saves + downloads every window file across
  // ALL sub-periods, so its count spans all periods — not just the active tab.
  const globalJoinedCount = periods.reduce(
    (total, period) =>
      total + period.rows.filter((row) => isJoinedRow(selection, customPrices, row.id)).length,
    0,
  );
  // Which window files (3/4/7-günlük) the export will produce + their product counts —
  // the pre-download preview shown in the export dialog. Mirrors the backend bucketing.
  const previewFiles = computeExportPreview(periods, selection, customPrices);
  const filteredRows = filterPlusRows(periodRows, selection, customPrices, filters);
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
    fn: (rows: typeof filteredRows, state: PlusSelectionState) => PlusSelectionState,
  ): void => {
    setChoices((prev) => fn(filteredRows, prev));
  };

  const onSaveExport = (): void => {
    // Persist EVERY row across ALL periods: a joined row exports its custom price when
    // custom-joined, else the ceiling when ceiling-joined; not-joined rows clear.
    const allRows = periods.flatMap((period) => period.rows);
    const selections = allRows.map((row) => {
      const custom = customPrices[row.id];
      return {
        itemId: row.id,
        selected: custom != null || selection[row.id] === 'plus',
        customPrice: custom?.price ?? null,
      };
    });
    updateSelections.mutate(
      { selections },
      {
        onSuccess: () => {
          exportTariff.mutate(tariffId, {
            // Filename comes from the server (a split week downloads a `.zip`); fall back
            // to the tariff name only if the header was absent.
            onSuccess: (file) => {
              downloadBlob(file.blob, file.filename ?? `${view.name}.xlsx`);
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
          // Bold "3 Gün" / "4 Gün" line + the date range as a muted sub-line.
          dayLabel:
            period.dayCount !== null
              ? tPage('periodDayLabel', { count: period.dayCount })
              : period.dateRangeLabel,
          rangeLabel: period.dayCount !== null ? period.dateRangeLabel : '',
          tone: STATUS_TONE[period.validity ?? 'past'],
        }))}
      />
    ) : null;

  const toolbar = (
    <PlusTariffsToolbar
      searchValue={filters.query}
      // Per-keystroke q writes REPLACE (no letter-by-letter Back history).
      onSearchChange={(next) => void setUrlState({ q: next }, { history: 'replace' })}
      categories={categories}
      brands={brands}
      filters={filters}
      onFiltersChange={applyFilters}
      onSelectBest={() => applyBulk(selectBestForAll)}
      onJoinProfitable={() => applyBulk(joinProfitable)}
      onClearJoins={() => applyBulk(clearJoins)}
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
          title={view.name}
          badge={<PlusTariffStatusBadge validity={activePeriod.validity} />}
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
              {/* Fixed export button (replaces the floating bar): opens a preview modal of
                  which window files will download before the seller confirms. */}
              <Button
                size="sm"
                onClick={() => setExportOpen(true)}
                disabled={globalJoinedCount === 0}
                leadingIcon={<DownloadCircle01Icon aria-hidden />}
              >
                {tPage('actions.export')}
              </Button>
            </div>
          }
          summary={<PlusTariffsSummary summary={summary} />}
        />

        <div className="hidden min-w-0 md:block">
          <PlusTariffsTable
            rows={filteredRows}
            selection={selection}
            customPrices={customPrices}
            customEstimates={customEstimates}
            onToggleJoin={handleToggleJoin}
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
          <PlusTariffsMobileCards
            rows={filteredRows}
            selection={selection}
            customPrices={customPrices}
            customEstimates={customEstimates}
            onToggleJoin={handleToggleJoin}
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
          // Two-phase: selections PATCH first, then the file downloads — so the dialog
          // can say which is happening ("kaydediliyor…" → "indiriliyor…").
          isSaving={updateSelections.isPending}
          isDownloading={exportTariff.isPending}
          onConfirm={onSaveExport}
        />
      </div>
    </TariffScopeProvider>
  );
}
