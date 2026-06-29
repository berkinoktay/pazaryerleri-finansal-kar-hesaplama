'use client';

import { ArrowLeft01Icon, Delete02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { FilterTabs } from '@/components/patterns/filter-tabs';
import { PageHeader } from '@/components/patterns/page-header';
import { Button } from '@/components/ui/button';

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
import { summarizeSelection } from '../lib/commission-tariff-summary';
import { MOCK_TARIFF_TEMPLATES } from '../lib/mock-commission-tariffs';
import type { BandKey, TariffTemplate } from '../types';
import { CommissionTariffsActionBar } from './commission-tariffs-action-bar';
import { CommissionTariffsList } from './commission-tariffs-list';
import { CommissionTariffsMobileCards } from './commission-tariffs-mobile-cards';
import { CommissionTariffsSummary } from './commission-tariffs-summary';
import { CommissionTariffsTable } from './commission-tariffs-table';
import { CommissionTariffsToolbar } from './commission-tariffs-toolbar';
import { CommissionTariffsUpload } from './commission-tariffs-upload';

const EMPTY_FILTERS: TariffFilterState = {
  query: '',
  category: null,
  brand: null,
  minMarginPct: null,
  profit: 'all',
  selection: 'all',
};

function distinct(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Product Commission Tariffs page — UI only, mock data, no backend.
 *
 * Master/detail: LIST of saved tariffs → open one → DETAIL (KPIs, action bar,
 * bulk tools, the band table / mobile cards) → back to list. CREATE (upload) is
 * shown when there are no tariffs yet or the seller adds another. Each tariff
 * owns its own band selections; "Kaydet ve İndir" marks it exported.
 */
export function CommissionTariffsPageClient(): React.ReactElement {
  const t = useTranslations('campaignsPages.productCommissionTariffs');
  const tPage = useTranslations('commissionTariffsPage');

  // Seed with the saved tariffs so the page opens on the LIST (the common case);
  // the upload/create screen is only for when there are genuinely none left.
  const [templates, setTemplates] = React.useState<TariffTemplate[]>(() => [
    ...MOCK_TARIFF_TEMPLATES,
  ]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [selections, setSelections] = React.useState<Record<string, SelectionMap>>(() => ({
    'tpl-2026-06-23': { r1: 'band2', r2: 'band2' },
  }));
  const [exportedIds, setExportedIds] = React.useState<Record<string, boolean>>({});
  const [periodId, setPeriodId] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<TariffFilterState>(EMPTY_FILTERS);
  const seqRef = React.useRef(MOCK_TARIFF_TEMPLATES.length);

  const addTemplate = React.useCallback((): void => {
    seqRef.current += 1;
    const sample = MOCK_TARIFF_TEMPLATES[(seqRef.current - 1) % MOCK_TARIFF_TEMPLATES.length];
    if (sample === undefined) return;
    const id = `tpl-${seqRef.current}`;
    setTemplates((prev) => [...prev, { ...sample, id }]);
    setSelections((prev) => ({ ...prev, [id]: {} }));
    setActiveId(id);
    setCreating(false);
    setPeriodId(null);
    setFilters(EMPTY_FILTERS);
  }, []);

  const openTemplate = React.useCallback((id: string): void => {
    setActiveId(id);
    setCreating(false);
    setPeriodId(null);
    setFilters(EMPTY_FILTERS);
  }, []);

  const backToList = React.useCallback((): void => {
    setActiveId(null);
    setCreating(false);
  }, []);

  const startCreate = React.useCallback((): void => {
    setActiveId(null);
    setCreating(true);
  }, []);

  const deleteTemplate = React.useCallback((id: string): void => {
    setTemplates((prev) => prev.filter((template) => template.id !== id));
    setSelections((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setExportedIds((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setActiveId((prev) => (prev === id ? null : prev));
  }, []);

  const handleSelectBand = React.useCallback(
    (rowId: string, band: BandKey): void => {
      if (activeId === null) return;
      setSelections((prev) => ({
        ...prev,
        [activeId]: { ...(prev[activeId] ?? {}), [rowId]: band },
      }));
    },
    [activeId],
  );

  const activeTemplate = templates.find((template) => template.id === activeId) ?? null;

  // ---- DETAIL ----
  if (activeTemplate !== null) {
    const templateId = activeTemplate.id;
    const periods = activeTemplate.periods;
    const activePeriod = periods.find((period) => period.id === periodId) ?? periods[0] ?? null;
    if (activePeriod === null) return <div />;

    const periodRows = activePeriod.rows;
    const selection = selections[templateId] ?? {};
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

    const applyBulk = (
      fn: (rows: typeof filteredRows, prev: SelectionMap) => SelectionMap,
    ): void => {
      setSelections((prev) => ({
        ...prev,
        [templateId]: fn(filteredRows, prev[templateId] ?? {}),
      }));
    };
    const onTargetMargin = (targetPct: number, strategy: TargetStrategy): void => {
      setSelections((prev) => ({
        ...prev,
        [templateId]: selectByTargetMargin(
          filteredRows,
          prev[templateId] ?? {},
          targetPct,
          strategy,
        ),
      }));
    };
    const onSaveExport = (): void => {
      setExportedIds((prev) => ({ ...prev, [templateId]: true }));
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
        onSearchChange={(next) => setFilters((prev) => ({ ...prev, query: next }))}
        categories={categories}
        brands={brands}
        filters={filters}
        onFiltersChange={(next) => setFilters((prev) => ({ ...prev, ...next }))}
        onClearFilters={() => setFilters(EMPTY_FILTERS)}
        hasActiveFilters={hasActiveFilters}
        onBestAll={() => applyBulk(selectBestForAll)}
        onProfitableOnly={() => applyBulk(selectProfitableOnly)}
        onTargetMargin={onTargetMargin}
        onClearSelections={() => applyBulk(clearSelections)}
      />
    );

    return (
      <div className="gap-lg flex flex-col">
        <PageHeader
          leading={
            <Button
              variant="ghost"
              size="sm"
              onClick={backToList}
              leadingIcon={<ArrowLeft01Icon aria-hidden />}
              className="-ml-xs"
            >
              {tPage('templates.back')}
            </Button>
          }
          title={activeTemplate.name}
          intent={activePeriod.dateRangeLabel}
          actions={
            <ConfirmDialog
              trigger={
                <Button variant="outline" size="sm" leadingIcon={<Delete02Icon aria-hidden />}>
                  {tPage('templates.delete')}
                </Button>
              }
              title={tPage('templates.deleteTitle')}
              description={tPage('templates.deleteDescription')}
              confirmLabel={tPage('templates.deleteConfirm')}
              onConfirm={() => deleteTemplate(templateId)}
            />
          }
          summary={<CommissionTariffsSummary summary={summary} />}
        />

        <CommissionTariffsActionBar
          selectedCount={summary.selectedCount}
          total={summary.total}
          selectedProfit={summary.selectedProfit}
          onBestAll={() => applyBulk(selectBestForAll)}
          onSaveExport={onSaveExport}
        />

        {periodTabs}
        {toolbar}

        <div className="hidden md:block">
          <CommissionTariffsTable
            rows={filteredRows}
            selection={selection}
            onSelectBand={handleSelectBand}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={() => setFilters(EMPTY_FILTERS)}
          />
        </div>
        <div className="md:hidden">
          <CommissionTariffsMobileCards
            rows={filteredRows}
            selection={selection}
            onSelectBand={handleSelectBand}
          />
        </div>
      </div>
    );
  }

  // ---- CREATE ----
  if (creating || templates.length === 0) {
    return (
      <div className="gap-lg flex flex-col">
        <PageHeader title={t('title')} intent={t('intent')} />
        <CommissionTariffsUpload
          onFile={addTemplate}
          onBack={templates.length > 0 ? backToList : undefined}
        />
      </div>
    );
  }

  // ---- LIST ----
  return (
    <div className="gap-lg flex flex-col">
      <PageHeader title={t('title')} intent={t('intent')} />
      <div className="gap-sm flex flex-col">
        <div className="gap-3xs flex flex-col">
          <h2 className="text-base font-semibold">{tPage('list.heading')}</h2>
          <p className="text-muted-foreground text-sm">{tPage('list.subheading')}</p>
        </div>
        <CommissionTariffsList
          templates={templates}
          selections={selections}
          exportedIds={exportedIds}
          onOpen={openTemplate}
          onDelete={deleteTemplate}
          onCreate={startCreate}
        />
      </div>
    </div>
  );
}
