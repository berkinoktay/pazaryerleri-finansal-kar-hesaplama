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

import { useAdvantageTariffDetail } from '../hooks/use-advantage-tariff-detail';
import { useDeleteAdvantageTariff } from '../hooks/use-delete-advantage-tariff';
import { useExportAdvantageTariff } from '../hooks/use-export-advantage-tariff';
import { useUpdateAdvantageSelections } from '../hooks/use-update-advantage-selections';
import { toAdvantageTariffView } from '../lib/adapt-advantage-tariff';
import {
  clearSelections,
  filterAdvantageRows,
  selectBestForAll,
  selectProfitable,
  type AdvantageCustomChoice,
  type AdvantageCustomPriceMap,
  type AdvantageSelectionState,
  type AdvantageTariffFilterState,
  type AdvantageTierMap,
  type NonNullStarTierKey,
} from '../lib/advantage-bulk-actions';
import { summarizeAdvantageSelection } from '../lib/advantage-tariff-summary';
import { downloadBlob } from '../lib/download-blob';
import { TariffScopeProvider } from '../lib/tariff-scope';
import { AdvantageCommissionSourceHeader } from './advantage-commission-source-header';
import { AdvantageCommissionWarning } from './advantage-commission-warning';
import { AdvantageTariffsMobileCards } from './advantage-tariffs-mobile-cards';
import { AdvantageTariffsSummary } from './advantage-tariffs-summary';
import { AdvantageTariffsTable } from './advantage-tariffs-table';
import { AdvantageTariffsToolbar } from './advantage-tariffs-toolbar';

const LIST_PATH = '/campaigns/product-labels';

function distinct(values: readonly (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => v !== null)));
}

/**
 * Data-bound DETAIL screen for one saved Advantage tariff. Loads it from the backend
 * (with the current + per-tier profit already computed per product, and the resolved
 * commission source), lets the seller pick ONE of four states per product — None /
 * Avantaj / Çok Avantaj / Süper Avantaj — or type a custom price, then persists the
 * choices + downloads the patched Trendyol xlsx on "Kaydet ve İndir". Choices buffer
 * locally (seeded from the server) then save via PATCH; the breakdown modal +
 * custom-price what-if call the estimate endpoint (scope provided via context). No
 * client-side money math. Unlike the commission/Plus verticals there are NO periods and
 * NO validity, and the reduced commission is READ from the store's commission-tariff
 * data — surfaced (and switchable) via the commission-source header above the table.
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
  const router = useRouter();
  const detail = useAdvantageTariffDetail(orgId ?? '', storeId, tariffId);
  const updateSelections = useUpdateAdvantageSelections(orgId ?? '', storeId ?? '', tariffId);
  const exportTariff = useExportAdvantageTariff(orgId ?? '', storeId ?? '');
  const deleteTariff = useDeleteAdvantageTariff(orgId ?? '', storeId ?? '');

  const view = React.useMemo(
    () => (detail.data !== undefined ? toAdvantageTariffView(detail.data) : null),
    [detail.data],
  );

  // Two MUTUALLY EXCLUSIVE per-row buffers: `tiers` = a chosen star tier;
  // `customPrices` = a confirmed custom price. A row is in at most one. Both stay local
  // (edit state) and save together on "Kaydet ve İndir".
  const [tiers, setTiers] = React.useState<AdvantageTierMap>({});
  const [customPrices, setCustomPrices] = React.useState<AdvantageCustomPriceMap>({});
  const [seededTariffId, setSeededTariffId] = React.useState<string | null>(null);
  // View state (filters) is URL-owned via nuqs: reload / share / back-forward reproduce
  // the exact view. The tri-states encode 'all' as an absent param; minMargin is a float
  // param. The selection buffer above stays local — edit state.
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
  // `customPrice` the first time this tariff's data arrives. Adjusting state during
  // render (guarded by the tariff id, so it fires once per tariff) is the
  // React-recommended alternative to a setState-in-effect — no cascading renders.
  if (view !== null && view.id !== seededTariffId) {
    const seedTiers: AdvantageTierMap = {};
    const seedCustom: AdvantageCustomPriceMap = {};
    for (const row of view.rows) {
      if (row.customPrice !== null) {
        // Custom-joined: restore the confirmed price. The custom price's exact profit
        // isn't in the detail payload, so approximate the summary with the best-tier
        // profit until the seller re-confirms (which captures the estimate).
        const best = row.tiers.find((tier) => tier.key === row.bestTierKey);
        seedCustom[row.id] = {
          price: row.customPrice,
          netProfit: best?.netProfit ?? null,
          marginPct: best?.marginPct ?? null,
        };
      } else if (row.selectedTier !== null) {
        seedTiers[row.id] = row.selectedTier;
      }
    }
    setTiers(seedTiers);
    setCustomPrices(seedCustom);
    setSeededTariffId(view.id);
  }

  const handleSelectTier = React.useCallback((rowId: string, key: NonNullStarTierKey): void => {
    // Toggle: re-tapping the chosen tier clears it (→ None). Choosing a tier clears any
    // custom price (mutually exclusive).
    setTiers((prev) => {
      const next = { ...prev };
      if (next[rowId] === key) {
        delete next[rowId];
      } else {
        next[rowId] = key;
      }
      return next;
    });
    setCustomPrices((prev) => (prev[rowId] == null ? prev : { ...prev, [rowId]: null }));
  }, []);

  const handleSelectCustom = React.useCallback(
    (rowId: string, choice: AdvantageCustomChoice): void => {
      // A confirmed custom price replaces any tier choice (mutually exclusive).
      setCustomPrices((prev) => ({ ...prev, [rowId]: choice }));
      setTiers((prev) => {
        if (prev[rowId] === undefined) return prev;
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
    },
    [],
  );

  const handleDeselectCustom = React.useCallback((rowId: string): void => {
    setCustomPrices((prev) => (prev[rowId] == null ? prev : { ...prev, [rowId]: null }));
  }, []);

  if (detail.isLoading) {
    // Full page-anatomy placeholder (back link + header + 4-cell summary strip + data
    // panel) mirroring the loaded layout below.
    return <PageSkeleton label={tCommon('loading')} withBackLink statCells={4} />;
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

  const rows = view.rows;
  const summary = summarizeAdvantageSelection(rows, tiers, customPrices);
  const filteredRows = filterAdvantageRows(rows, tiers, customPrices, filters);
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
    const next = fn(filteredRows, { tiers, customPrices });
    setTiers(next.tiers);
    setCustomPrices(next.customPrices);
  };

  const onSaveExport = (): void => {
    // A row exports its custom price when custom-joined, else its chosen tier's target
    // price; the backend counts a row "selected" when it has a tier OR a custom price.
    const selections = rows.map((row) => {
      const custom = customPrices[row.id];
      if (custom != null) {
        return { itemId: row.id, tier: null, customPrice: custom.price };
      }
      return { itemId: row.id, tier: tiers[row.id] ?? null, customPrice: null };
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
      {/* Reserve space for the floating save bar while products are selected, so the
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
          intent={tPage('templates.detailIntent')}
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
            tiers={tiers}
            customPrices={customPrices}
            onSelectTier={handleSelectTier}
            onSelectCustom={handleSelectCustom}
            onDeselectCustom={handleDeselectCustom}
            toolbar={toolbar}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={resetFilters}
          />
        </div>
        <div className="gap-sm flex flex-col md:hidden">
          {toolbar}
          <AdvantageTariffsMobileCards
            rows={filteredRows}
            tiers={tiers}
            customPrices={customPrices}
            onSelectTier={handleSelectTier}
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
