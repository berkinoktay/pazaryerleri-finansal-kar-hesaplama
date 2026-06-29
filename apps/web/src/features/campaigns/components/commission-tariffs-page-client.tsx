'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { FilterTabs } from '@/components/patterns/filter-tabs';
import { PageHeader } from '@/components/patterns/page-header';
import { Button } from '@/components/ui/button';

import { useCommissionTariffFilters } from '../hooks/use-commission-tariff-filters';
import { summarizeSelection } from '../lib/commission-tariff-summary';
import { MOCK_TARIFF_WEEKS } from '../lib/mock-commission-tariffs';
import type { BandKey } from '../types';
import { CommissionTariffsSummary } from './commission-tariffs-summary';
import { CommissionTariffsTable } from './commission-tariffs-table';
import { CommissionTariffsUpload } from './commission-tariffs-upload';

/**
 * Product Commission Tariffs page — UI only, mock data, no backend.
 *
 * Two states: (1) empty → Excel upload; (2) populated → KPI strip + period tabs
 * + the profitability table. The period structure is data-driven: the week tabs
 * come from the data, and the per-week period tabs (e.g. a 3-day / 4-day split)
 * only appear when a week actually has more than one period. The table always
 * shows the four bands of the selected period.
 */
export function CommissionTariffsPageClient(): React.ReactElement {
  const t = useTranslations('campaignsPages.productCommissionTariffs');
  const tPage = useTranslations('commissionTariffsPage');
  const { filters, setFilters } = useCommissionTariffFilters();
  const [uploaded, setUploaded] = React.useState(false);
  const [selection, setSelection] = React.useState<Record<string, BandKey | null>>({});

  const handleSelectBand = React.useCallback((rowId: string, band: BandKey) => {
    setSelection((prev) => ({ ...prev, [rowId]: band }));
  }, []);

  if (!uploaded) {
    return (
      <div className="gap-lg flex flex-col">
        <PageHeader title={t('title')} intent={t('intent')} />
        <CommissionTariffsUpload onFile={() => setUploaded(true)} />
      </div>
    );
  }

  // Data-driven resolution: match opaque ids, fall back to the first available.
  const activeWeek = MOCK_TARIFF_WEEKS.find((w) => w.id === filters.week) ?? MOCK_TARIFF_WEEKS[0];
  if (activeWeek === undefined) return <div />;
  const periods = activeWeek.periods;
  const activePeriod = periods.find((p) => p.id === filters.period) ?? periods[0];
  if (activePeriod === undefined) return <div />;

  const periodRows = activePeriod.rows;
  const summary = summarizeSelection(periodRows, selection);

  const applyBestToAll = (): void => {
    setSelection((prev) => {
      const next = { ...prev };
      for (const row of periodRows) next[row.id] = row.bestBand;
      return next;
    });
  };

  const query = filters.q.trim().toLocaleLowerCase('tr');
  const rows =
    query === ''
      ? periodRows
      : periodRows.filter((r) =>
          [r.productTitle, r.modelCode, r.barcode].some((field) =>
            field.toLocaleLowerCase('tr').includes(query),
          ),
        );

  const periodTabs = (
    <div className="gap-2xs flex flex-col">
      <FilterTabs
        value={activeWeek.id}
        onValueChange={(next) => void setFilters({ week: next, period: null })}
        options={MOCK_TARIFF_WEEKS.map((w) => ({ value: w.id, label: w.label }))}
      />
      {periods.length > 1 ? (
        <FilterTabs
          value={activePeriod.id}
          onValueChange={(next) => void setFilters({ period: next })}
          options={periods.map((p) => ({ value: p.id, label: p.dateRangeLabel }))}
        />
      ) : null}
    </div>
  );

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader
        title={t('title')}
        intent={activePeriod.dateRangeLabel}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setUploaded(false)}>
              {tPage('actions.upload')}
            </Button>
            <Button size="sm">{tPage('actions.saveExport')}</Button>
          </>
        }
        summary={<CommissionTariffsSummary summary={summary} onApplyBest={applyBestToAll} />}
      />
      <CommissionTariffsTable
        rows={rows}
        tabs={periodTabs}
        selection={selection}
        onSelectBand={handleSelectBand}
        searchValue={filters.q}
        onSearchChange={(next) => void setFilters({ q: next })}
        onImport={() => setUploaded(false)}
        onClearFilters={() => void setFilters({ q: '' })}
      />
    </div>
  );
}
