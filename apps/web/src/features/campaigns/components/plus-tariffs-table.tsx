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
import { TrendyolPlusLockup } from '@/components/patterns/trendyol-plus-lockup';
import { formatPercentDisplay } from '@/lib/format-percent';
import { TABLE_SCALE_DEFAULT } from '@/lib/table-scale';

import { usePlusReasonLabel } from '../hooks/use-plus-reason-label';
import type { PlusSelectionMap } from '../lib/plus-bulk-actions';
import type { PlusTariffDetailItem } from '../types';
import { PlusBandCell } from './plus-band-cell';
import { PlusCustomPriceCell } from './plus-custom-price-cell';

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
  const reasonLabel = usePlusReasonLabel();
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
                {!r.calculable && r.reason !== null ? (
                  <span className="text-warning">{reasonLabel(r.reason)}</span>
                ) : null}
              </span>
            }
          />
        );
      },
    };

    const currentColumn: ColumnDef<PlusTariffDetailItem> = {
      id: 'current',
      header: t('table.current'),
      meta: { label: t('table.current') },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="gap-3xs flex flex-col text-sm">
            <div className="font-semibold tabular-nums">
              <Currency value={r.current.price} />
            </div>
            <div className="text-2xs text-muted-foreground">
              {t('table.currentCommission')}{' '}
              <span className="text-foreground font-medium tabular-nums">
                {formatPercentDisplay(r.current.commissionPct)}
              </span>
            </div>
          </div>
        );
      },
    };

    const offerColumn: ColumnDef<PlusTariffDetailItem> = {
      id: 'offer',
      // Column header: the full "trendyol plus" lockup + "Fiyat Aralığı", so the
      // offer column reads as the Trendyol Plus price range. `meta.label` stays
      // plain text ("Plus Fiyat Aralığı") for the column-visibility menu + a11y.
      // h-6: the lockup's wordmark is ~half its box height, so h-6 (24px) lands
      // the "trendyol plus" text at ~12px — matching the text-xs header label so
      // the two read as one line. leading-none tightens the label's line box so
      // it optically centers with the lockup rather than floating.
      header: () => (
        <span className="gap-2xs inline-flex items-center">
          <TrendyolPlusLockup className="h-6" />
          <span className="leading-none">{t('table.priceRange')}</span>
        </span>
      ),
      meta: { label: t('table.plus') },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <PlusBandCell
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

    return [productColumn, currentColumn, offerColumn, customPriceColumn];
  }, [t, reasonLabel, selection, onToggleJoin]);

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
