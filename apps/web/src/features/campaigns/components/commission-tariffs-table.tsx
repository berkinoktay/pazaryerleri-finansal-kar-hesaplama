'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Decimal } from 'decimal.js';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { EmptyState } from '@/components/patterns/empty-state';
import { IdentityCell } from '@/components/patterns/identity-cell';
import { MoneyInput } from '@/components/patterns/money-input';
import { ProfitCell } from '@/components/patterns/profit-cell';

import { findBand } from '../lib/commission-tariff-summary';
import type { BandKey, CommissionTariffRow } from '../types';
import { PriceBandCell } from './price-band-cell';

const BAND_INDEXES = [0, 1, 2, 3] as const;

/**
 * Custom-price "what-if" field. Owns its own value so typing never rebuilds the
 * table's column defs (which would steal focus). The estimated profit is left
 * to the backend on save — the frontend only captures the price.
 */
function CustomPriceField({ label }: { label: string }): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.table');
  const [value, setValue] = React.useState<Decimal | null>(null);
  return (
    <div className="gap-3xs flex flex-col">
      <MoneyInput
        value={value}
        onChange={setValue}
        nonNegative
        aria-label={label}
        placeholder={t('enterPrice')}
        className="max-w-input-narrow"
      />
      <span className="text-2xs text-muted-foreground">{t('customPriceHint')}</span>
    </div>
  );
}

export interface CommissionTariffsTableProps {
  rows: readonly CommissionTariffRow[];
  tabs?: React.ReactNode;
  /** Per-product chosen band (null = none chosen yet). */
  selection: Readonly<Record<string, BandKey | null>>;
  onSelectBand: (rowId: string, band: BandKey) => void;
  searchValue: string;
  onSearchChange: (next: string) => void;
  onImport: () => void;
  onClearFilters: () => void;
}

export function CommissionTariffsTable({
  rows,
  tabs,
  selection,
  onSelectBand,
  searchValue,
  onSearchChange,
  onImport,
  onClearFilters,
}: CommissionTariffsTableProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const format = useFormatter();

  const columns = React.useMemo<ColumnDef<CommissionTariffRow>[]>(() => {
    const productColumn: ColumnDef<CommissionTariffRow> = {
      id: 'product',
      header: t('table.product'),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <IdentityCell
            size="md"
            leading={<div className="bg-muted size-9 shrink-0 rounded-md" aria-hidden />}
            title={r.productTitle}
            meta={
              <span className="gap-3xs flex flex-col">
                <span className="truncate">
                  {r.category} · {r.brand}
                </span>
                <span className="truncate tabular-nums">
                  {r.modelCode} · {t('table.stock')} {r.stock}
                </span>
              </span>
            }
          />
        );
      },
    };

    const currentColumn: ColumnDef<CommissionTariffRow> = {
      id: 'current',
      header: t('table.current'),
      meta: { numeric: true, label: t('table.current') },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="gap-3xs flex flex-col items-end">
            <span className="text-sm font-semibold tabular-nums">
              <Currency value={r.currentPrice} />
            </span>
            <span className="text-2xs text-muted-foreground tabular-nums">
              {format.number(r.currentCommissionPct.toNumber(), 'percent')} {t('table.commission')}
            </span>
          </div>
        );
      },
    };

    const bandColumns: ColumnDef<CommissionTariffRow>[] = BAND_INDEXES.map((i) => ({
      id: `band${i + 1}`,
      header: t('table.band', { n: i + 1 }),
      cell: ({ row }) => {
        const r = row.original;
        const band = r.bands[i];
        return (
          <PriceBandCell
            band={band}
            isBest={r.bestBand === band.key}
            bestLabel={t('table.best')}
            selected={selection[r.id] === band.key}
            onSelect={(key) => onSelectBand(r.id, key)}
          />
        );
      },
    }));

    const yourChoiceColumn: ColumnDef<CommissionTariffRow> = {
      id: 'yourChoice',
      header: t('table.yourChoice'),
      meta: { numeric: true, label: t('table.yourChoice') },
      cell: ({ row }) => {
        const r = row.original;
        const chosen = selection[r.id];
        const band = chosen === undefined || chosen === null ? undefined : findBand(r, chosen);
        if (band === undefined) {
          return <span className="text-2xs text-muted-foreground">{t('table.noChoice')}</span>;
        }
        return <ProfitCell value={band.profit} marginPct={band.marginPct} />;
      },
    };

    const customPriceColumn: ColumnDef<CommissionTariffRow> = {
      id: 'customPrice',
      header: t('table.customPrice'),
      cell: ({ row }) => (
        <CustomPriceField label={`${t('table.customPrice')} — ${row.original.productTitle}`} />
      ),
    };

    return [productColumn, currentColumn, ...bandColumns, yourChoiceColumn, customPriceColumn];
  }, [t, format, selection, onSelectBand]);

  return (
    <DataTable<CommissionTariffRow, unknown>
      columns={columns}
      data={[...rows]}
      tabs={tabs}
      getRowId={(row) => row.id}
      initialColumnPinning={{ left: ['product'] }}
      hasActiveFilters={searchValue !== ''}
      onClearFilters={onClearFilters}
      noResultsState={
        <EmptyState
          title={t('noResults.title')}
          description={t('noResults.description')}
          embedded
        />
      }
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          searchPlaceholder={t('search')}
          onImport={onImport}
        />
      )}
      pagination={(table) => <DataTablePagination table={table} pageSizes={[25, 50, 100]} />}
    />
  );
}
