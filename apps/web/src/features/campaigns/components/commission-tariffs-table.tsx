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
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';

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
          <div className="gap-2xs flex flex-col text-sm">
            <div>
              <div className="text-2xs text-muted-foreground">{t('table.salePrice')}</div>
              <div className="font-semibold tabular-nums">
                <Currency value={r.currentPrice} />
              </div>
            </div>
            {/* Only when the customer-facing price differs from the sale price
                (a storefront discount) — otherwise it's a redundant duplicate row. */}
            {!r.displayPrice.equals(r.currentPrice) ? (
              <div>
                <div className="text-2xs text-muted-foreground">{t('table.displayPrice')}</div>
                <div className="tabular-nums">
                  <Currency value={r.displayPrice} />
                </div>
              </div>
            ) : null}
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
      toolbar={toolbar !== undefined ? () => toolbar : undefined}
      pagination={(table) => <DataTablePagination table={table} pageSizes={[25, 50, 100]} />}
    />
  );
}
