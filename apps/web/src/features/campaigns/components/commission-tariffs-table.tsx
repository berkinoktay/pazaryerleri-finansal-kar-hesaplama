'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { EmptyState } from '@/components/patterns/empty-state';
import { IdentityCell } from '@/components/patterns/identity-cell';
import { ProductImageCell } from '@/components/patterns/product-image-cell';
import { TableScaleControl } from '@/components/patterns/table-scale-control';
import { formatPercentDisplay } from '@/lib/format-percent';
import { TABLE_SCALE_DEFAULT } from '@/lib/table-scale';

import { useReasonLabel } from '../hooks/use-reason-label';
import type { CustomChoice, CustomPriceMap, SelectionMap } from '../lib/bulk-actions';
import type { CommissionTariffRow } from '../types';
import { CustomPriceCell } from './custom-price-cell';
import { PriceBandCell } from './price-band-cell';

const BAND_INDEXES = [0, 1, 2, 3] as const;

export interface CommissionTariffsTableProps {
  rows: readonly CommissionTariffRow[];
  selection: SelectionMap;
  /** Custom-price opt-ins (rowId → confirmed custom choice). */
  customPrices: CustomPriceMap;
  onSelectBand: (rowId: string, band: string) => void;
  onSelectCustom: (rowId: string, band: string, choice: CustomChoice) => void;
  onDeselectCustom: (rowId: string) => void;
  tabs?: React.ReactNode;
  toolbar?: React.ReactNode;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function CommissionTariffsTable({
  rows,
  selection,
  customPrices,
  onSelectBand,
  onSelectCustom,
  onDeselectCustom,
  tabs,
  toolbar,
  hasActiveFilters,
  onClearFilters,
}: CommissionTariffsTableProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const reasonLabel = useReasonLabel();
  // Local (not persisted): every tariff opens at its normal 100% size; the
  // seller can shrink it to fit for that session.
  const [scale, setScale] = React.useState(TABLE_SCALE_DEFAULT);

  const columns = React.useMemo<ColumnDef<CommissionTariffRow>[]>(() => {
    const productColumn: ColumnDef<CommissionTariffRow> = {
      id: 'product',
      header: t('table.product'),
      cell: ({ row }) => {
        const r = row.original;
        const categoryBrand = [r.category, r.brand]
          .filter((v): v is string => v !== null)
          .join(' · ');
        return (
          <IdentityCell
            size="md"
            titleLines={2}
            className="max-w-tariff-product"
            leading={<ProductImageCell url={r.imageUrl} alt={r.productTitle} size="lg" />}
            title={r.productTitle}
            meta={
              <span className="gap-3xs flex flex-col">
                {categoryBrand !== '' ? <span className="truncate">{categoryBrand}</span> : null}
                {r.stockCode !== null ? (
                  <span className="truncate tabular-nums">{r.stockCode}</span>
                ) : null}
                {!r.calculable && r.reason !== null ? (
                  <span className="text-warning">{reasonLabel(r.reason)}</span>
                ) : null}
              </span>
            }
          />
        );
      },
    };

    const currentColumn: ColumnDef<CommissionTariffRow> = {
      id: 'current',
      // Every non-product column centers its header + content (seller preference).
      header: () => <span className="block w-full text-center">{t('table.current')}</span>,
      meta: { label: t('table.current') },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="gap-3xs flex w-full flex-col items-center text-center text-sm">
            <div className="font-semibold tabular-nums">
              <Currency value={r.currentPrice} />
            </div>
            <div className="text-2xs text-muted-foreground">
              {t('table.currentCommission')}{' '}
              <span className="text-foreground font-medium tabular-nums">
                {formatPercentDisplay(r.currentCommissionPct)}
              </span>
            </div>
          </div>
        );
      },
    };

    const bandColumns: ColumnDef<CommissionTariffRow>[] = BAND_INDEXES.map((i) => ({
      id: `band${i + 1}`,
      header: () => <span className="block w-full text-center">{t('table.band', { n: i + 1 })}</span>,
      meta: { label: t('table.band', { n: i + 1 }) },
      cell: ({ row }) => {
        const r = row.original;
        const band = r.bands[i];
        if (band === undefined) return null;
        // Center the band card in its column cell so all non-product columns align.
        return (
          <div className="flex w-full justify-center">
            <PriceBandCell
              row={r}
              band={band}
              isBest={r.bestBandKey === band.key}
              // A band card reflects only a PLAIN boundary choice — when a custom
              // price is active it drives the derived band, so no card lights up.
              selected={selection[r.id] === band.key && customPrices[r.id] == null}
              onSelect={(key) => onSelectBand(r.id, key)}
            />
          </div>
        );
      },
    }));

    const customPriceColumn: ColumnDef<CommissionTariffRow> = {
      id: 'customPrice',
      header: () => <span className="block w-full text-center">{t('table.customPrice')}</span>,
      cell: ({ row }) => (
        <CustomPriceCell
          row={row.original}
          isSelected={customPrices[row.original.id] != null}
          onSelect={(band, choice) => onSelectCustom(row.original.id, band, choice)}
          onDeselect={() => onDeselectCustom(row.original.id)}
          centered
        />
      ),
    };

    return [productColumn, currentColumn, ...bandColumns, customPriceColumn];
  }, [t, reasonLabel, selection, customPrices, onSelectBand, onSelectCustom, onDeselectCustom]);

  return (
    <DataTable<CommissionTariffRow, unknown>
      columns={columns}
      data={[...rows]}
      tabs={tabs}
      getRowId={(row) => row.id}
      initialColumnPinning={{ left: ['product'] }}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      noResultsState={
        <EmptyState
          title={t('noResults.title')}
          description={t('noResults.description')}
          embedded
        />
      }
      scale={scale}
      toolbar={() => (
        <div className="gap-sm flex flex-wrap items-center justify-between">
          <div className="min-w-0 flex-1">{toolbar}</div>
          <TableScaleControl value={scale} onChange={setScale} className="shrink-0" />
        </div>
      )}
      pagination={(table) => <DataTablePagination table={table} />}
    />
  );
}
