'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { PackageIcon } from 'hugeicons-react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { EmptyState } from '@/components/patterns/empty-state';
import { IdentityCell } from '@/components/patterns/identity-cell';
import { TableScaleControl } from '@/components/patterns/table-scale-control';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';
import { TABLE_SCALE_DEFAULT } from '@/lib/table-scale';

import type { SelectionMap } from '../lib/bulk-actions';
import type { BandKey, CommissionTariffRow } from '../types';
import { CustomPriceCell } from './custom-price-cell';
import { PriceBandCell } from './price-band-cell';

const BAND_INDEXES = [0, 1, 2, 3] as const;

export interface CommissionTariffsTableProps {
  rows: readonly CommissionTariffRow[];
  selection: SelectionMap;
  onSelectBand: (rowId: string, band: BandKey) => void;
  tabs?: React.ReactNode;
  toolbar?: React.ReactNode;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function CommissionTariffsTable({
  rows,
  selection,
  onSelectBand,
  tabs,
  toolbar,
  hasActiveFilters,
  onClearFilters,
}: CommissionTariffsTableProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const format = useFormatter();
  // Local (not persisted): every tariff opens at its normal 100% size; the
  // seller can shrink it to fit for that session.
  const [scale, setScale] = React.useState(TABLE_SCALE_DEFAULT);

  const columns = React.useMemo<ColumnDef<CommissionTariffRow>[]>(() => {
    const productColumn: ColumnDef<CommissionTariffRow> = {
      id: 'product',
      header: t('table.product'),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <IdentityCell
            size="md"
            leading={
              <SoftSquareIcon tone="neutral" variant="soft" size="md">
                <PackageIcon />
              </SoftSquareIcon>
            }
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
      meta: { label: t('table.current') },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="gap-3xs flex flex-col text-sm">
            {/* Sale price is the hero; the "Satış fiyatı" label only appears when a
                distinct customer-facing price (storefront discount) must be told apart —
                otherwise the "Güncel fiyat" column header already names it. */}
            {r.displayPrice.equals(r.currentPrice) ? (
              <div className="font-semibold tabular-nums">
                <Currency value={r.currentPrice} />
              </div>
            ) : (
              <>
                <div>
                  <div className="text-2xs text-muted-foreground">{t('table.salePrice')}</div>
                  <div className="font-semibold tabular-nums">
                    <Currency value={r.currentPrice} />
                  </div>
                </div>
                <div>
                  <div className="text-2xs text-muted-foreground">{t('table.displayPrice')}</div>
                  <div className="tabular-nums">
                    <Currency value={r.displayPrice} />
                  </div>
                </div>
              </>
            )}
            <div className="text-2xs text-muted-foreground">
              {t('table.currentCommission')}{' '}
              <span className="text-foreground font-medium tabular-nums">
                {format.number(r.currentCommissionPct.toNumber(), 'percent')}
              </span>
            </div>
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
            row={r}
            band={band}
            isBest={r.bestBand === band.key}
            isCurrent={i === 0}
            selected={selection[r.id] === band.key}
            onSelect={(key) => onSelectBand(r.id, key)}
          />
        );
      },
    }));

    const customPriceColumn: ColumnDef<CommissionTariffRow> = {
      id: 'customPrice',
      header: t('table.customPrice'),
      cell: ({ row }) => <CustomPriceCell row={row.original} />,
    };

    return [productColumn, currentColumn, ...bandColumns, customPriceColumn];
  }, [t, format, selection, onSelectBand]);

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
