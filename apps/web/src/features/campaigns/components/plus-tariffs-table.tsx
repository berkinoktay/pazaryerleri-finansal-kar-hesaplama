'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { EmptyState } from '@/components/patterns/empty-state';
import { IdentityCell } from '@/components/patterns/identity-cell';
import { ProductImageCell } from '@/components/patterns/product-image-cell';
import { TableScaleControl } from '@/components/patterns/table-scale-control';
import { TABLE_SCALE_DEFAULT } from '@/lib/table-scale';

import type { PlusSelectionMap } from '../lib/plus-bulk-actions';
import type { PlusTariffDetailItem } from '../types';
import { PlusCustomPriceCell } from './plus-custom-price-cell';
import { PlusOfferCell } from './plus-offer-cell';

export interface PlusTariffsTableProps {
  rows: readonly PlusTariffDetailItem[];
  selection: PlusSelectionMap;
  onToggleJoin: (rowId: string) => void;
  toolbar?: React.ReactNode;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function PlusTariffsTable({
  rows,
  selection,
  onToggleJoin,
  toolbar,
  hasActiveFilters,
  onClearFilters,
}: PlusTariffsTableProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage');
  // Local (not persisted): every tariff opens at its normal 100% size; the seller
  // can shrink it to fit for that session.
  const [scale, setScale] = React.useState(TABLE_SCALE_DEFAULT);

  const columns = React.useMemo<ColumnDef<PlusTariffDetailItem>[]>(() => {
    const productColumn: ColumnDef<PlusTariffDetailItem> = {
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
              </span>
            }
          />
        );
      },
    };

    const offerColumn: ColumnDef<PlusTariffDetailItem> = {
      id: 'offer',
      header: t('table.plus'),
      meta: { label: t('table.plus') },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <PlusOfferCell
            row={r}
            selected={selection[r.id] === true}
            onToggle={() => onToggleJoin(r.id)}
          />
        );
      },
    };

    const customPriceColumn: ColumnDef<PlusTariffDetailItem> = {
      id: 'customPrice',
      header: t('table.customPrice'),
      cell: ({ row }) => <PlusCustomPriceCell row={row.original} />,
    };

    return [productColumn, offerColumn, customPriceColumn];
  }, [t, selection, onToggleJoin]);

  return (
    <DataTable<PlusTariffDetailItem, unknown>
      columns={columns}
      data={[...rows]}
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
