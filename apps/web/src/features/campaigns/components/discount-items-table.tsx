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
import { ProfitBadge } from '@/components/patterns/profit-badge';
import { TableScaleControl } from '@/components/patterns/table-scale-control';
import { Checkbox } from '@/components/ui/checkbox';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { TABLE_SCALE_DEFAULT } from '@/lib/table-scale';

import { useDiscountReasonEmptyLabel } from '../hooks/use-discount-reason-label';
import type { DiscountRow } from '../lib/adapt-discount-list';
import { DiscountBuyboxBadge } from './discount-buybox-badge';
import { ProfitDelta } from './profit-delta';

/** Which price scenario a profit badge opens in the breakdown modal. */
export type DiscountScenarioKey = 'current' | 'discounted';

/**
 * The single VOLATILE value the cells need beyond their row data — whether a selections mutation
 * is in flight (so the checkbox disables). Streamed through CONTEXT rather than baked into the
 * `columns` closure so `columns` stays identity-stable: rebuilding it would remount every cell.
 * (`row.included` is NOT volatile-closure state — it flows through the row data.)
 */
const DiscountRowStateContext = React.createContext<{ selectionsPending: boolean }>({
  selectionsPending: false,
});

/** Participation checkbox — reads the pending flag from context, not the column closure. */
function IncludeCellSlot({
  row,
  label,
  onToggle,
}: {
  row: DiscountRow;
  label: string;
  onToggle: (itemId: string, included: boolean) => void;
}): React.ReactElement {
  const { selectionsPending } = React.useContext(DiscountRowStateContext);
  return (
    <Checkbox
      checked={row.included}
      disabled={selectionsPending}
      aria-label={label}
      onCheckedChange={(next) => onToggle(row.id, next === true)}
      className="cursor-pointer"
    />
  );
}

export interface DiscountItemsTableProps {
  rows: readonly DiscountRow[];
  /** True while a selections mutation is in flight — disables the row checkboxes. */
  selectionsPending: boolean;
  /** Persists a single row's participation choice (mode 'set'). */
  onToggleInclude: (itemId: string, included: boolean) => void;
  /** Opens the profit breakdown modal for a row's scenario. */
  onOpenBreakdown: (row: DiscountRow, scenario: DiscountScenarioKey) => void;
  toolbar?: React.ReactNode;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

/**
 * The İndirimler detail table: one row per product with a participation checkbox, its identity,
 * buybox ownership, the CURRENT and DISCOUNTED price scenarios (each a price + a clickable
 * profit badge that opens the breakdown), the discounted scenario's commission source, and the
 * "güncele göre" profit delta. Every figure is backend-computed; the badge/delta only render.
 * The bulk selection lives in the toolbar, so there is NO header checkbox. Row count can reach
 * 500, so the body paginates.
 */
export function DiscountItemsTable({
  rows,
  selectionsPending,
  onToggleInclude,
  onOpenBreakdown,
  toolbar,
  hasActiveFilters,
  onClearFilters,
}: DiscountItemsTableProps): React.ReactElement {
  const t = useTranslations('discountsPage.table');
  const tNoResults = useTranslations('discountsPage.noResults');
  const tSource = useTranslations('discountsPage.commissionSource');
  const reasonEmptyLabel = useDiscountReasonEmptyLabel();
  const scale = useMarginColoring();
  // Local (not persisted): every list opens at 100%; the seller can shrink it for the session.
  const [tableScale, setTableScale] = React.useState(TABLE_SCALE_DEFAULT);

  const columns = React.useMemo<ColumnDef<DiscountRow>[]>(() => {
    // Concrete-key label map (next-intl's typed `t` takes a literal, not the source union). Built
    // inside the memo so it stays stable while `columns` does.
    const sourceLabel: Record<'band' | 'product' | 'category', string> = {
      band: tSource('band'),
      product: tSource('product'),
      category: tSource('category'),
    };

    const includeColumn: ColumnDef<DiscountRow> = {
      id: 'include',
      header: t('included'),
      cell: ({ row }) => (
        <IncludeCellSlot row={row.original} label={t('includeRow')} onToggle={onToggleInclude} />
      ),
    };

    const productColumn: ColumnDef<DiscountRow> = {
      id: 'product',
      header: t('product'),
      cell: ({ row }) => {
        const r = row.original;
        const meta = [r.brand, r.color, r.modelCode]
          .filter((value): value is string => value !== null && value !== '')
          .join(' · ');
        return (
          <IdentityCell
            size="md"
            titleLines={2}
            className="max-w-tariff-product"
            leading={<ProductImageCell url={r.imageUrl} alt={r.productTitle} size="xl" />}
            title={r.productTitle}
            meta={
              <span className="gap-3xs flex flex-col">
                {meta !== '' ? <span className="truncate tabular-nums">{meta}</span> : null}
                <span className="truncate tabular-nums">{r.barcode}</span>
              </span>
            }
          />
        );
      },
    };

    const buyboxColumn: ColumnDef<DiscountRow> = {
      id: 'buybox',
      header: t('buybox'),
      cell: ({ row }) => <DiscountBuyboxBadge status={row.original.buyboxStatus} />,
    };

    const currentColumn: ColumnDef<DiscountRow> = {
      id: 'current',
      header: t('currentPrice'),
      meta: { label: t('currentPrice') },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="gap-3xs flex flex-col items-start">
            <Currency value={r.current.price} className="text-sm font-medium" />
            <ProfitBadge
              value={r.current.netProfit}
              marginPct={r.current.marginPct}
              scale={scale}
              onOpen={() => onOpenBreakdown(r, 'current')}
              emptyLabel={reasonEmptyLabel(r.reason)}
            />
          </div>
        );
      },
    };

    const discountedColumn: ColumnDef<DiscountRow> = {
      id: 'discounted',
      header: t('discountedPrice'),
      meta: { label: t('discountedPrice') },
      cell: ({ row }) => {
        const r = row.original;
        const source = r.discounted.commissionSource;
        return (
          <div className="gap-3xs flex flex-col items-start">
            <Currency value={r.discounted.price} className="text-sm font-medium" />
            <ProfitBadge
              value={r.discounted.netProfit}
              marginPct={r.discounted.marginPct}
              scale={scale}
              onOpen={() => onOpenBreakdown(r, 'discounted')}
              emptyLabel={reasonEmptyLabel(r.reason)}
            />
            {source !== null ? (
              <span className="text-2xs text-muted-foreground">{sourceLabel[source]}</span>
            ) : null}
          </div>
        );
      },
    };

    const deltaColumn: ColumnDef<DiscountRow> = {
      id: 'delta',
      header: t('delta'),
      meta: { label: t('delta') },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <ProfitDelta
            optionNetProfit={r.discounted.netProfit}
            currentNetProfit={r.current.netProfit}
            label={t('delta')}
          />
        );
      },
    };

    return [
      includeColumn,
      productColumn,
      buyboxColumn,
      currentColumn,
      discountedColumn,
      deltaColumn,
    ];
    // `columns` identity MUST stay STABLE. Every dep is identity-stable: `t`/`tSource` from
    // next-intl, `onToggleInclude`/`onOpenBreakdown` from the parent's useCallback, and
    // `reasonEmptyLabel` (useCallback-stable). `scale` only changes when the seller edits their
    // margin ramp (rare) and there is no fragile cell input to lose.
  }, [t, tSource, scale, onToggleInclude, onOpenBreakdown, reasonEmptyLabel]);

  const rowState = React.useMemo(() => ({ selectionsPending }), [selectionsPending]);

  // Fresh array copy for TanStack (it mutates its own row model), memoized so the reference is
  // stable across unrelated re-renders — only a new `rows` prop rebuilds it.
  const data = React.useMemo(() => [...rows], [rows]);

  return (
    <DiscountRowStateContext.Provider value={rowState}>
      <DataTable<DiscountRow, unknown>
        columns={columns}
        data={data}
        getRowId={(row) => row.id}
        initialColumnPinning={{ left: ['include', 'product'] }}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={onClearFilters}
        noResultsState={
          <EmptyState
            title={tNoResults('title')}
            description={tNoResults('description')}
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
    </DiscountRowStateContext.Provider>
  );
}
