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

import { useFlashProductDetail } from '../hooks/use-flash-product-detail';
import { useDeleteFlashProducts } from '../hooks/use-delete-flash-products';
import { useExportFlashProducts } from '../hooks/use-export-flash-products';
import { useUpdateFlashSelections } from '../hooks/use-update-flash-selections';
import {
  OFFER_KEY_TO_ENUM,
  offerKeyFromEnum,
  toFlashProductView,
  type FlashOfferKey,
} from '../lib/adapt-flash-product';
import {
  clearSelections,
  filterFlashRows,
  selectBestForAll,
  selectProfitable,
  type FlashCustomChoice,
  type FlashCustomPriceMap,
  type FlashProductFilterState,
  type FlashSelectionMap,
  type FlashSelectionState,
} from '../lib/flash-bulk-actions';
import { summarizeFlashSelection } from '../lib/flash-product-summary';
import { downloadBlob } from '../lib/download-blob';
import { TariffScopeProvider } from '../lib/tariff-scope';
import type { ExportPreviewFile } from '../lib/whole-week';
import { ExportTariffDialog } from './export-tariff-dialog';
import { FlashProductsMobileCards } from './flash-products-mobile-cards';
import { FlashProductsSummary } from './flash-products-summary';
import { FlashProductsTable } from './flash-products-table';
import { FlashProductsToolbar } from './flash-products-toolbar';

const LIST_PATH = '/campaigns/flash-products';

function distinct(values: readonly (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => v !== null)));
}

/**
 * Data-bound DETAIL screen for one saved Flash Products upload. Loads it from the backend
 * (current + per-offer profit already computed per row, and each offer's dated window),
 * lets the seller pick ONE flash offer per row — 24 Saatlik / 3 Saatlik — or type a custom
 * price (capped at the lowest offer), then persists the choices + downloads the patched
 * Trendyol xlsx via the export dialog. Choices buffer locally (seeded from the server) then
 * save via PATCH; the breakdown modal + custom-price what-if call the estimate endpoint
 * (scope provided via context). No client-side money math. Unlike the commission/Plus
 * verticals there are NO periods; the reduced commission is AUTO-resolved per row from the
 * store's commission-tariff data, so there is no commission-source header. Each ROW is one
 * product × one date — the SAME product may appear on several rows, which is expected.
 */
export function FlashProductDetailClient({
  orgId,
  storeId,
  listId,
}: {
  orgId: string | null;
  storeId: string | null;
  listId: string;
}): React.ReactElement {
  const tPage = useTranslations('flashProductsPage');
  const tCommon = useTranslations('common');
  const tExport = useTranslations('flashProductsPage.exportDialog');
  const router = useRouter();
  const detail = useFlashProductDetail(orgId ?? '', storeId, listId);
  const updateSelections = useUpdateFlashSelections(orgId ?? '', storeId ?? '', listId);
  const exportList = useExportFlashProducts(orgId ?? '', storeId ?? '');
  const deleteList = useDeleteFlashProducts(orgId ?? '', storeId ?? '');

  const view = React.useMemo(
    () => (detail.data !== undefined ? toFlashProductView(detail.data) : null),
    [detail.data],
  );

  // `selection` = the chosen flash offer per row; `customPrices` = the optional custom
  // amount chosen instead. The two are MUTUALLY EXCLUSIVE per row. Both stay local (edit
  // state) and save together via the export dialog.
  //
  // They live in ONE state object so the select/deselect handlers below can be
  // identity-stable `useCallback([])`: a functional `setChoices((prev) => …)` reads BOTH
  // maps from `prev`, so no handler needs `customPrices` in its deps. A stable handler
  // identity keeps the table's `columns` from rebuilding (which would remount every cell
  // and wipe a half-typed custom price). See flash-products-table.tsx.
  const [choices, setChoices] = React.useState<FlashSelectionState>({
    selection: {},
    customPrices: {},
  });
  const { selection, customPrices } = choices;
  // UNCOMMITTED live what-if profit per row (the figure the custom-price card shows while
  // the seller is still typing). It exists ONLY to let the "En kârlı" badge race the live
  // estimate before "Bu fiyatı seç" — it never feeds export or the summary.
  const [customEstimates, setCustomEstimates] = React.useState<Record<string, string | null>>({});
  // Uncommitted "what-if" draft prices per row, kept in a REF so they survive the cell
  // unmounting (pagination / filter). Map semantics: NO key = never touched (fall back to
  // committed / server seed), value `null` = the seller deliberately cleared it (stay
  // empty), a string = the draft price. A ref, not state, because the draft must NOT drive
  // renders — the "En kârlı" marker already tracks the live figure through `customEstimates`.
  const customDraftsRef = React.useRef(new Map<string, string | null>());
  const getCustomDraft = React.useCallback(
    (rowId: string): string | null | undefined => customDraftsRef.current.get(rowId),
    [],
  );
  const handleCustomDraftChange = React.useCallback((rowId: string, price: string | null): void => {
    customDraftsRef.current.set(rowId, price);
  }, []);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [seededListId, setSeededListId] = React.useState<string | null>(null);
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
  const filters: FlashProductFilterState = {
    query: urlState.q,
    category: urlState.category,
    brand: urlState.brand,
    minMarginPct: urlState.minMargin,
    profit: urlState.profit ?? 'all',
    selection: urlState.selection ?? 'all',
  };
  const applyFilters = (next: Partial<FlashProductFilterState>): void => {
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

  // Seed the editable selection buffer from the server-authoritative `selectedOffer` /
  // `customPrice` the first time this list's data arrives. Adjusting state during render
  // (guarded by the list id, so it fires once per list) is the React-recommended
  // alternative to a setState-in-effect — no cascading renders.
  if (view !== null && view.id !== seededListId) {
    const seedSelection: FlashSelectionMap = {};
    const seedCustom: FlashCustomPriceMap = {};
    for (const row of view.rows) {
      if (row.customPrice !== null) {
        // Custom-joined: restore the confirmed price. Its exact profit isn't in the detail
        // payload (there is no single scenario for an arbitrary custom price), so seed the
        // summary figure as null — the live estimate on the visible card fills it in, and
        // re-confirming captures it.
        seedCustom[row.id] = { price: row.customPrice, netProfit: null, marginPct: null };
      } else {
        const offerKey = offerKeyFromEnum(row.selectedOffer);
        if (offerKey !== null) seedSelection[row.id] = offerKey;
      }
    }
    setChoices({ selection: seedSelection, customPrices: seedCustom });
    setSeededListId(view.id);
  }

  const handleSelectOffer = React.useCallback((rowId: string, key: FlashOfferKey): void => {
    // Toggle: re-tapping the chosen offer clears it (→ None). Choosing an offer clears any
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

  const handleSelectCustom = React.useCallback((rowId: string, choice: FlashCustomChoice): void => {
    // A confirmed custom price replaces any offer choice (mutually exclusive).
    setChoices((prev) => ({
      selection:
        prev.selection[rowId] == null ? prev.selection : { ...prev.selection, [rowId]: null },
      customPrices: { ...prev.customPrices, [rowId]: choice },
    }));
  }, []);

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
    // Full page-anatomy placeholder (back link + header + 4-cell summary strip + data
    // panel) mirroring the loaded layout below.
    return <PageSkeleton label={tCommon('loading')} withBackLink statCells={4} framed />;
  }

  // Distinguish a genuine 404 (deleted / cross-tenant — non-disclosure convention says show
  // "not found") from a transient fetch failure (5xx / network — offer a retry, don't imply
  // the list is gone). The global onError already toasts.
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
  // Column visibility (Berkin's rule): a 24h / 3h column is rendered only when at least one
  // row in the FULL set carries that offer — computed here so a filter never toggles it.
  const showOffer24 = rows.some((row) => row.bands.some((band) => band.key === 'h24'));
  const showOffer3 = rows.some((row) => row.bands.some((band) => band.key === 'h3'));
  const summary = summarizeFlashSelection(rows, selection, customPrices);
  const filteredRows = filterFlashRows(rows, selection, customPrices, filters);
  // Single export file (no periods): every joined row patched into the one xlsx. `dayCount`
  // is a placeholder — the flash export dialog never labels a file with days.
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
    fn: (rows: typeof filteredRows, state: FlashSelectionState) => FlashSelectionState,
  ): void => {
    setChoices((prev) => fn(filteredRows, prev));
  };

  const onSaveExport = (): void => {
    // A row exports its custom price when custom-joined, else its chosen offer; the backend
    // counts a row "selected" when it has an offer OR a custom price. The client enforces
    // the XOR: custom → offer null + price; offer → offer enum + null price.
    const selections = rows.map((row) => {
      const custom = customPrices[row.id];
      if (custom != null) {
        return { itemId: row.id, offer: null, customPrice: custom.price };
      }
      const offerKey = selection[row.id];
      return {
        itemId: row.id,
        offer: offerKey != null ? OFFER_KEY_TO_ENUM[offerKey] : null,
        customPrice: null,
      };
    });
    updateSelections.mutate(
      { selections },
      {
        onSuccess: () => {
          exportList.mutate(listId, {
            // Filename comes from the server; fall back to the list name only if the header
            // was absent.
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
    <FlashProductsToolbar
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
    <TariffScopeProvider scope={{ orgId, storeId, tariffId: listId }}>
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
              {/* Fixed export button (replaces the floating bar): opens a preview modal of
                  the file that will download before the seller confirms. */}
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
          summary={<FlashProductsSummary summary={summary} />}
        />

        <div className="hidden min-w-0 md:block">
          <FlashProductsTable
            rows={filteredRows}
            selection={selection}
            customPrices={customPrices}
            customEstimates={customEstimates}
            showOffer24={showOffer24}
            showOffer3={showOffer3}
            onSelectOffer={handleSelectOffer}
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
          <FlashProductsMobileCards
            rows={filteredRows}
            selection={selection}
            customPrices={customPrices}
            customEstimates={customEstimates}
            onSelectOffer={handleSelectOffer}
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
            // Flash exports a single xlsx — the label never uses a day count.
            fileName: () => tExport('fileName'),
            productCount: (count) => tExport('productCount', { count }),
            // Never rendered: flash always produces exactly one file, so the multi-file ZIP
            // note never shows (guarded by `files.length > 1`).
            zipNote: () => '',
            cancel: tExport('cancel'),
            download: tExport('download'),
            saving: tExport('saving'),
            exporting: tExport('exporting'),
          }}
          // Two-phase: selections PATCH first, then the file downloads — so the dialog can
          // say which is happening ("kaydediliyor…" → "indiriliyor…").
          isSaving={updateSelections.isPending}
          isDownloading={exportList.isPending}
          onConfirm={onSaveExport}
        />
      </div>
    </TariffScopeProvider>
  );
}
