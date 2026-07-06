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

import { useAdvantageTariffDetail } from '../hooks/use-advantage-tariff-detail';
import { useDeleteAdvantageTariff } from '../hooks/use-delete-advantage-tariff';
import { useExportAdvantageTariff } from '../hooks/use-export-advantage-tariff';
import { useUpdateAdvantageSelections } from '../hooks/use-update-advantage-selections';
import { toAdvantageTariffView, type NonNullStarTierKey } from '../lib/adapt-advantage-tariff';
import {
  clearSelections,
  filterAdvantageRows,
  selectBestForAll,
  selectProfitable,
  type AdvantageCustomChoice,
  type AdvantageCustomPriceMap,
  type AdvantageSelectionMap,
  type AdvantageSelectionState,
  type AdvantageTariffFilterState,
} from '../lib/advantage-bulk-actions';
import { summarizeAdvantageSelection } from '../lib/advantage-tariff-summary';
import { downloadBlob } from '../lib/download-blob';
import { TariffScopeProvider } from '../lib/tariff-scope';
import type { ExportPreviewFile } from '../lib/whole-week';
import { AdvantageCommissionSourceHeader } from './advantage-commission-source-header';
import { AdvantageCommissionWarning } from './advantage-commission-warning';
import { AdvantageTariffsMobileCards } from './advantage-tariffs-mobile-cards';
import { AdvantageTariffsSummary } from './advantage-tariffs-summary';
import { AdvantageTariffsTable } from './advantage-tariffs-table';
import { AdvantageTariffsToolbar } from './advantage-tariffs-toolbar';
import { ExportTariffDialog } from './export-tariff-dialog';

const LIST_PATH = '/campaigns/product-labels';

function distinct(values: readonly (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => v !== null)));
}

/**
 * Data-bound DETAIL screen for one saved Advantage tariff. Loads it from the backend (with
 * the current + per-tier profit already computed per product, and the resolved commission
 * source), lets the seller pick ONE star tier per product — Avantaj / Çok Avantaj / Süper
 * Avantaj — or type a custom price, then persists the choices + downloads the patched
 * Trendyol xlsx via the export dialog. Choices buffer locally (seeded from the server) then
 * save via PATCH; the breakdown modal + custom-price what-if call the estimate endpoint
 * (scope provided via context). No client-side money math. Unlike the commission/Plus
 * verticals there are NO periods and NO validity, and the reduced commission is READ from
 * the store's commission-tariff data — surfaced (and switchable) via the commission-source
 * header above the table. Mirrors the Plus detail one-to-one — the domain differences are
 * up to three star tiers per row instead of one Plus offer, and no sub-period tabs.
 */
export function AdvantageTariffDetailClient({
  orgId,
  storeId,
  tariffId,
}: {
  orgId: string | null;
  storeId: string | null;
  tariffId: string;
}): React.ReactElement {
  const tPage = useTranslations('productLabelsPage');
  const tCommon = useTranslations('common');
  const tExport = useTranslations('productLabelsPage.exportDialog');
  const router = useRouter();
  const detail = useAdvantageTariffDetail(orgId ?? '', storeId, tariffId);
  const updateSelections = useUpdateAdvantageSelections(orgId ?? '', storeId ?? '', tariffId);
  const exportTariff = useExportAdvantageTariff(orgId ?? '', storeId ?? '');
  const deleteTariff = useDeleteAdvantageTariff(orgId ?? '', storeId ?? '');

  const view = React.useMemo(
    () => (detail.data !== undefined ? toAdvantageTariffView(detail.data) : null),
    [detail.data],
  );

  // `selection` = the chosen star tier per row; `customPrices` = the optional custom amount
  // chosen instead. The two are MUTUALLY EXCLUSIVE per row. Both stay local (edit state) and
  // save together via the export dialog.
  //
  // They live in ONE state object so the select/deselect handlers below can be
  // identity-stable `useCallback([])`: a functional `setChoices((prev) => …)` reads BOTH
  // maps from `prev`, so no handler needs `customPrices` in its deps. A stable handler
  // identity is what keeps the table's `columns` from rebuilding — rebuilding remounts every
  // cell (flexRender renders each `cell:` as a component) and wipes a half-typed custom
  // price. See advantage-tariffs-table.tsx.
  const [choices, setChoices] = React.useState<AdvantageSelectionState>({
    selection: {},
    customPrices: {},
  });
  const { selection, customPrices } = choices;
  // UNCOMMITTED live what-if profit per row (the figure the custom-price card shows while the
  // seller is still typing). It exists ONLY to let the "En kârlı" badge race the live
  // estimate before "Bu fiyatı seç" — it never feeds export or the summary.
  const [customEstimates, setCustomEstimates] = React.useState<Record<string, string | null>>({});
  // Uncommitted "what-if" draft prices per row, kept in a REF so they survive the cell
  // unmounting (pagination / filter). Map semantics: NO key = never touched (fall back to
  // committed / server seed), value `null` = the seller deliberately cleared it (stay empty),
  // a string = the draft price. A ref, not state, because the draft must NOT drive renders —
  // the "En kârlı" marker already tracks the live figure through `customEstimates`.
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
  // View state (filters) is URL-owned via nuqs: reload / share / back-forward reproduce the
  // exact view. The tri-states encode 'all' as an absent param; minMargin is a float param.
  // The selection buffer above stays local — edit state.
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
  const filters: AdvantageTariffFilterState = {
    query: urlState.q,
    category: urlState.category,
    brand: urlState.brand,
    minMarginPct: urlState.minMargin,
    profit: urlState.profit ?? 'all',
    selection: urlState.selection ?? 'all',
  };
  const applyFilters = (next: Partial<AdvantageTariffFilterState>): void => {
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

  // Seed the editable selection buffer from the server-authoritative `selectedTier` /
  // `customPrice` the first time this tariff's data arrives. Adjusting state during render
  // (guarded by the tariff id, so it fires once per tariff) is the React-recommended
  // alternative to a setState-in-effect — no cascading renders.
  if (view !== null && view.id !== seededTariffId) {
    const seedSelection: AdvantageSelectionMap = {};
    const seedCustom: AdvantageCustomPriceMap = {};
    for (const row of view.rows) {
      if (row.customPrice !== null) {
        // Custom-joined: restore the confirmed price. Its exact profit isn't in the detail
        // payload (there is no single scenario for an arbitrary custom price on this
        // vertical), so seed the summary figure as null — the live estimate on the visible
        // card fills it in, and re-confirming captures it.
        seedCustom[row.id] = { price: row.customPrice, netProfit: null, marginPct: null };
      } else if (row.selectedTier !== null) {
        seedSelection[row.id] = row.selectedTier;
      }
    }
    setChoices({ selection: seedSelection, customPrices: seedCustom });
    setSeededTariffId(view.id);
  }

  const handleSelectTier = React.useCallback((rowId: string, key: NonNullStarTierKey): void => {
    // Toggle: re-tapping the chosen tier clears it (→ None). Choosing a tier clears any
    // custom price (mutually exclusive). Both maps are read from `prev` so the handler needs
    // no deps (stable identity).
    setChoices((prev) => {
      const isSame = prev.selection[rowId] === key && prev.customPrices[rowId] == null;
      return {
        selection: { ...prev.selection, [rowId]: isSame ? null : key },
        customPrices:
          prev.customPrices[rowId] == null
            ? prev.customPrices
            : { ...prev.customPrices, [rowId]: null },
      };
    });
  }, []);

  const handleSelectCustom = React.useCallback(
    (rowId: string, choice: AdvantageCustomChoice): void => {
      // A confirmed custom price replaces any tier choice (mutually exclusive).
      setChoices((prev) => ({
        selection:
          prev.selection[rowId] == null ? prev.selection : { ...prev.selection, [rowId]: null },
        customPrices: { ...prev.customPrices, [rowId]: choice },
      }));
    },
    [],
  );

  const handleDeselectCustom = React.useCallback((rowId: string): void => {
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
      // Identity guard — the debounced estimate often resolves to the same figure; skip the
      // state update (and the re-render) when nothing actually changed.
      setCustomEstimates((prev) =>
        prev[rowId] === netProfit ? prev : { ...prev, [rowId]: netProfit },
      );
    },
    [],
  );

  if (detail.isLoading) {
    // Full page-anatomy placeholder (back link + header + 4-cell summary strip + data panel)
    // mirroring the loaded layout below.
    return <PageSkeleton label={tCommon('loading')} withBackLink statCells={4} framed />;
  }

  // Distinguish a genuine 404 (deleted / cross-tenant — non-disclosure convention says show
  // "not found") from a transient fetch failure (5xx / network — offer a retry, don't imply
  // the tariff is gone). The global onError already toasts.
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
  const summary = summarizeAdvantageSelection(rows, selection, customPrices);
  const filteredRows = filterAdvantageRows(rows, selection, customPrices, filters);
  // Single export file (no sub-periods): every joined product patched into the one xlsx.
  // `dayCount` is a placeholder — the advantage export dialog never labels a file with days.
  const previewFiles: ExportPreviewFile[] =
    summary.joinedCount > 0 ? [{ dayCount: 0, count: summary.joinedCount }] : [];
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
    fn: (rows: typeof filteredRows, state: AdvantageSelectionState) => AdvantageSelectionState,
  ): void => {
    setChoices((prev) => fn(filteredRows, prev));
  };

  const onSaveExport = (): void => {
    // A row exports its custom price when custom-joined, else its chosen tier's target
    // price; the backend counts a row "selected" when it has a tier OR a custom price.
    const selections = rows.map((row) => {
      const custom = customPrices[row.id];
      if (custom != null) {
        return { itemId: row.id, tier: null, customPrice: custom.price };
      }
      return { itemId: row.id, tier: selection[row.id] ?? null, customPrice: null };
    });
    updateSelections.mutate(
      { selections },
      {
        onSuccess: () => {
          exportTariff.mutate(tariffId, {
            // Filename comes from the server; fall back to the tariff name only if the
            // header was absent.
            onSuccess: (file) => {
              downloadBlob(file.blob, file.filename ?? `${view.name}.xlsx`);
              setExportOpen(false);
            },
          });
        },
      },
    );
  };

  const toolbar = (
    <AdvantageTariffsToolbar
      searchValue={filters.query}
      // Per-keystroke q writes REPLACE (no letter-by-letter Back history).
      onSearchChange={(next) => void setUrlState({ q: next }, { history: 'replace' })}
      categories={categories}
      brands={brands}
      filters={filters}
      onFiltersChange={applyFilters}
      onSelectBest={() => applyBulk(selectBestForAll)}
      onSelectProfitable={() => applyBulk(selectProfitable)}
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
                  deleteTariff.mutate(tariffId, { onSuccess: () => router.push(LIST_PATH) })
                }
              />
              {/* Fixed export button (replaces the floating bar): opens a preview modal of the
                  file that will download before the seller confirms. */}
              <Button
                size="sm"
                onClick={() => setExportOpen(true)}
                disabled={summary.joinedCount === 0}
                leadingIcon={<DownloadCircle01Icon aria-hidden />}
              >
                {tPage('actions.export')}
              </Button>
            </div>
          }
          summary={<AdvantageTariffsSummary summary={summary} />}
        />

        <AdvantageCommissionSourceHeader
          orgId={orgId}
          storeId={storeId}
          tariffId={tariffId}
          commissionSource={view.commissionSource}
          commissionSourceMode={view.commissionSourceMode}
        />

        <AdvantageCommissionWarning
          commissionSourceMode={view.commissionSourceMode}
          hasUnmatchedCommissionProducts={view.hasUnmatchedCommissionProducts}
        />

        <div className="hidden min-w-0 md:block">
          <AdvantageTariffsTable
            rows={filteredRows}
            selection={selection}
            customPrices={customPrices}
            customEstimates={customEstimates}
            onSelectTier={handleSelectTier}
            onSelectCustom={handleSelectCustom}
            onDeselectCustom={handleDeselectCustom}
            onCustomEstimate={handleCustomEstimate}
            getCustomDraft={getCustomDraft}
            onCustomDraftChange={handleCustomDraftChange}
            toolbar={toolbar}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={resetFilters}
          />
        </div>
        <div className="gap-sm flex flex-col md:hidden">
          {toolbar}
          <AdvantageTariffsMobileCards
            rows={filteredRows}
            selection={selection}
            customPrices={customPrices}
            customEstimates={customEstimates}
            onSelectTier={handleSelectTier}
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
            // Advantage exports a single xlsx — the label never uses a day count.
            fileName: () => tExport('fileName'),
            productCount: (count) => tExport('productCount', { count }),
            // Never rendered: advantage always produces exactly one file, so the multi-file
            // ZIP note never shows (guarded by `files.length > 1`).
            zipNote: () => '',
            cancel: tExport('cancel'),
            download: tExport('download'),
            saving: tExport('saving'),
            exporting: tExport('exporting'),
          }}
          // Two-phase: selections PATCH first, then the file downloads — so the dialog can say
          // which is happening ("kaydediliyor…" → "indiriliyor…").
          isSaving={updateSelections.isPending}
          isDownloading={exportTariff.isPending}
          onConfirm={onSaveExport}
        />
      </div>
    </TariffScopeProvider>
  );
}
