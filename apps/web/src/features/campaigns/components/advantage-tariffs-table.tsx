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
import { marginColorStyle } from '@/lib/margin-color-style';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { TABLE_SCALE_DEFAULT } from '@/lib/table-scale';

import { useAdvantageReasonLabel } from '../hooks/use-advantage-reason-label';
import {
  tierForKey,
  type AdvantageCustomChoice,
  type AdvantageCustomPriceMap,
  type AdvantageTierMap,
  type NonNullStarTierKey,
} from '../lib/advantage-bulk-actions';
import type { AdvantageTariffDetailItem } from '../types';
import { AdvantageCustomPriceCell } from './advantage-custom-price-cell';
import { AdvantageTierCell } from './advantage-tier-cell';

const DASH = '—';

/** Column render order for the three star tiers — Avantaj → Çok Avantaj → Süper Avantaj. */
const TIER_KEYS = ['tier1', 'tier2', 'tier3'] as const satisfies readonly NonNullStarTierKey[];

export interface AdvantageTariffsTableProps {
  rows: readonly AdvantageTariffDetailItem[];
  /** Tier opt-ins (rowId → chosen tier). */
  tiers: AdvantageTierMap;
  /** Custom-price opt-ins (rowId → confirmed custom choice), mutually exclusive with `tiers`. */
  customPrices: AdvantageCustomPriceMap;
  onSelectTier: (rowId: string, key: NonNullStarTierKey) => void;
  onSelectCustom: (rowId: string, choice: AdvantageCustomChoice) => void;
  onDeselectCustom: (rowId: string) => void;
  toolbar?: React.ReactNode;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function AdvantageTariffsTable({
  rows,
  tiers,
  customPrices,
  onSelectTier,
  onSelectCustom,
  onDeselectCustom,
  toolbar,
  hasActiveFilters,
  onClearFilters,
}: AdvantageTariffsTableProps): React.ReactElement {
  const t = useTranslations('productLabelsPage');
  const tTier = useTranslations('productLabelsPage.tier');
  const reasonLabel = useAdvantageReasonLabel();
  const marginScale = useMarginColoring();
  // Local (not persisted): every tariff opens at its normal 100% size; the seller can
  // shrink it to fit for that session.
  const [tableScale, setTableScale] = React.useState(TABLE_SCALE_DEFAULT);

  const columns = React.useMemo<ColumnDef<AdvantageTariffDetailItem>[]>(() => {
    const productColumn: ColumnDef<AdvantageTariffDetailItem> = {
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

    const currentColumn: ColumnDef<AdvantageTariffDetailItem> = {
      id: 'current',
      // Every non-product column centers its header + content (seller preference).
      header: () => <span className="block w-full text-center">{t('table.current')}</span>,
      meta: { label: t('table.current') },
      cell: ({ row }) => {
        const r = row.original;
        // Trendyol levies commission and checks badge eligibility on the price the buyer
        // actually pays. Lead with that (customerPrice); surface the raw Trendyol list
        // price (currentPrice / TSF) only when a discount makes the two differ.
        const hasDiscount = r.currentPrice !== r.customerPrice;
        return (
          <div className="gap-3xs flex w-full flex-col items-center text-center text-sm">
            {hasDiscount ? (
              <span className="text-2xs text-muted-foreground">{t('table.displayPrice')}</span>
            ) : null}
            <div className="font-semibold tabular-nums">
              <Currency value={r.customerPrice} />
            </div>
            {hasDiscount ? (
              <span className="text-2xs text-muted-foreground tabular-nums">
                {t('table.salePrice')} <Currency value={r.currentPrice} />
              </span>
            ) : null}
            <span className="text-2xs text-muted-foreground">{t('table.calculatedProfit')}</span>
            {r.current.netProfit !== null ? (
              <span
                className="text-sm font-medium tabular-nums"
                // runtime-dynamic: margin-driven tinted text for the baseline profit
                style={marginColorStyle(r.current.marginPct, marginScale)}
              >
                <Currency value={r.current.netProfit} /> ·{' '}
                {formatPercentDisplay(r.current.marginPct)}
              </span>
            ) : (
              <span className="text-muted-foreground text-sm">{DASH}</span>
            )}
          </div>
        );
      },
    };

    const tierColumns: ColumnDef<AdvantageTariffDetailItem>[] = TIER_KEYS.map((key) => ({
      id: key,
      header: () => <span className="block w-full text-center">{tTier(key)}</span>,
      meta: { label: tTier(key) },
      cell: ({ row }) => {
        const r = row.original;
        const tier = tierForKey(r, key);
        if (tier === undefined) {
          return <div className="text-muted-foreground w-full text-center text-sm">{DASH}</div>;
        }
        return (
          <AdvantageTierCell
            row={r}
            tier={tier}
            isBest={r.bestTierKey === key}
            selected={tiers[r.id] === key}
            onToggle={() => onSelectTier(r.id, key)}
            centered
          />
        );
      },
    }));

    const customPriceColumn: ColumnDef<AdvantageTariffDetailItem> = {
      id: 'customPrice',
      header: () => <span className="block w-full text-center">{t('table.customPrice')}</span>,
      cell: ({ row }) => (
        <AdvantageCustomPriceCell
          row={row.original}
          isSelected={customPrices[row.original.id] != null}
          onSelect={(choice) => onSelectCustom(row.original.id, choice)}
          onDeselect={() => onDeselectCustom(row.original.id)}
          centered
        />
      ),
    };

    return [productColumn, currentColumn, ...tierColumns, customPriceColumn];
  }, [
    t,
    tTier,
    reasonLabel,
    marginScale,
    tiers,
    customPrices,
    onSelectTier,
    onSelectCustom,
    onDeselectCustom,
  ]);

  return (
    <DataTable<AdvantageTariffDetailItem, unknown>
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
      scale={tableScale}
      toolbar={() => (
        <div className="gap-sm flex flex-wrap items-center justify-between">
          <div className="min-w-0 flex-1">{toolbar}</div>
          <TableScaleControl value={tableScale} onChange={setTableScale} className="shrink-0" />
        </div>
      )}
      pagination={(table) => <DataTablePagination table={table} />}
    />
  );
}
