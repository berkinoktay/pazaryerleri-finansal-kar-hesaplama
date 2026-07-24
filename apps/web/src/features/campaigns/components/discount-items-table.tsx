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
import { DiscountCommissionCell } from './discount-commission-cell';
import { ProfitDelta } from './profit-delta';

/** Which price scenario a profit badge opens in the breakdown modal. */
export type DiscountScenarioKey = 'current' | 'discounted';

/**
 * State the cells need beyond their row data, streamed through CONTEXT rather than baked into the
 * `columns` closure so `columns` stays identity-stable — rebuilding it would remount every cell.
 * Carries the VOLATILE `selectionsPending` (disables the checkbox during a save flush) and the
 * ephemeral `selectedIds` set (drives each checkbox's checked state) plus the detail-level
 * commission tariff name + period (the band tooltip), which are stable for a loaded detail but
 * still live off the row. Selection is NOT on the row — it lives in the client's local set.
 */
const DiscountRowStateContext = React.createContext<{
  selectionsPending: boolean;
  selectedIds: ReadonlySet<string>;
  commissionTariffName: string | null;
  commissionPeriodLabel: string | null;
}>({
  selectionsPending: false,
  selectedIds: new Set(),
  commissionTariffName: null,
  commissionPeriodLabel: null,
});

/** Participation checkbox — reads the pending flag + local selection from context, not the row. */
function IncludeCellSlot({
  row,
  label,
  onToggle,
}: {
  row: DiscountRow;
  label: string;
  onToggle: (itemId: string, included: boolean) => void;
}): React.ReactElement {
  const { selectionsPending, selectedIds } = React.useContext(DiscountRowStateContext);
  return (
    <Checkbox
      checked={selectedIds.has(row.id)}
      disabled={selectionsPending}
      aria-label={label}
      onCheckedChange={(next) => onToggle(row.id, next === true)}
      className="cursor-pointer"
    />
  );
}

/**
 * Commission cell — reads the detail-level tariff name/period from context (not the column
 * closure, keeping `columns` identity-stable) and renders the shared {@link DiscountCommissionCell}.
 */
function CommissionCellSlot({ row }: { row: DiscountRow }): React.ReactElement {
  const { commissionTariffName, commissionPeriodLabel } = React.useContext(DiscountRowStateContext);
  return (
    <DiscountCommissionCell
      current={row.current}
      discounted={row.discounted}
      tariffName={commissionTariffName}
      periodLabel={commissionPeriodLabel}
      commissionBands={row.commissionBands}
    />
  );
}

export interface DiscountItemsTableProps {
  rows: readonly DiscountRow[];
  /** The client's EPHEMERAL local selection — drives each row checkbox's checked state. */
  selectedIds: ReadonlySet<string>;
  /** Detail-level commission tariff NAME feeding the bands — the band tooltip's first part. */
  commissionTariffName: string | null;
  /** Detail-level commission tariff PERIOD label — the band tooltip's second part. */
  commissionPeriodLabel: string | null;
  /** True while a save flush is in flight — disables the row checkboxes. */
  selectionsPending: boolean;
  /** Toggles a single row's participation in the local selection set. */
  onToggleInclude: (itemId: string, included: boolean) => void;
  /** Opens the profit breakdown modal for a row's scenario. */
  onOpenBreakdown: (row: DiscountRow, scenario: DiscountScenarioKey) => void;
  toolbar?: React.ReactNode;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

/**
 * The İndirimler detail table: one row per product with a participation checkbox, its identity,
 * and the CURRENT and DISCOUNTED price scenarios (each a price + a clickable profit badge that
 * opens the breakdown). The discounted scenario also carries the "güncele göre" profit delta
 * directly under its badge (mirroring the flash detail). Every figure is backend-computed; the
 * badge/delta only render. The bulk selection lives in the toolbar, so there is NO header
 * checkbox. Row count can reach 500, so the body paginates.
 */
export function DiscountItemsTable({
  rows,
  selectedIds,
  commissionTariffName,
  commissionPeriodLabel,
  selectionsPending,
  onToggleInclude,
  onOpenBreakdown,
  toolbar,
  hasActiveFilters,
  onClearFilters,
}: DiscountItemsTableProps): React.ReactElement {
  const t = useTranslations('discountsPage.table');
  const tNoResults = useTranslations('discountsPage.noResults');
  const reasonEmptyLabel = useDiscountReasonEmptyLabel();
  const scale = useMarginColoring();
  // Local (not persisted): every list opens at 100%; the seller can shrink it for the session.
  const [tableScale, setTableScale] = React.useState(TABLE_SCALE_DEFAULT);

  const columns = React.useMemo<ColumnDef<DiscountRow>[]>(() => {
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
            {/* "Güncele göre" delta sits directly under the discounted badge — mirroring the
                flash detail's TariffProfitBlock, not a standalone column. */}
            <ProfitDelta
              optionNetProfit={r.discounted.netProfit}
              currentNetProfit={r.current.netProfit}
              label={t('delta')}
            />
          </div>
        );
      },
    };

    const commissionColumn: ColumnDef<DiscountRow> = {
      id: 'commission',
      header: t('commission'),
      meta: { label: t('commission') },
      // Detail-level tariff name/period the hint needs flow through context, NOT this closure,
      // so `columns` stays identity-stable (they'd otherwise force a dep + rebuild on reload).
      cell: ({ row }) => <CommissionCellSlot row={row.original} />,
    };

    // Commission sits right after the product identity — before the current/discounted price
    // scenarios — so the seller reads "which product · at what commission" before the money.
    return [includeColumn, productColumn, commissionColumn, currentColumn, discountedColumn];
    // `columns` identity MUST stay STABLE. Every dep is identity-stable: `t` from next-intl,
    // `onToggleInclude`/`onOpenBreakdown` from the parent's useCallback, and `reasonEmptyLabel`
    // (useCallback-stable). `scale` only changes when the seller edits their margin ramp (rare)
    // and there is no fragile cell input to lose.
  }, [t, scale, onToggleInclude, onOpenBreakdown, reasonEmptyLabel]);

  const rowState = React.useMemo(
    () => ({ selectionsPending, selectedIds, commissionTariffName, commissionPeriodLabel }),
    [selectionsPending, selectedIds, commissionTariffName, commissionPeriodLabel],
  );

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
