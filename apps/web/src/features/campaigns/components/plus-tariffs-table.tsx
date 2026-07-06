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
import { TrendyolPlusLockup } from '@/components/patterns/trendyol-plus-lockup';
import { TABLE_SCALE_DEFAULT } from '@/lib/table-scale';

import { usePlusReasonLabel } from '../hooks/use-plus-reason-label';
import type { PlusTariffRow } from '../lib/adapt-plus-tariff';
import { resolveBestChoice } from '../lib/best-choice';
import type {
  PlusCustomChoice,
  PlusCustomPriceMap,
  PlusSelectionMap,
} from '../lib/plus-bulk-actions';
import { PlusBandCell } from './plus-band-cell';
import { PlusCurrentPriceCell } from './plus-current-price-cell';
import { PlusCustomPriceCell } from './plus-custom-price-cell';

/**
 * Per-row VOLATILE state streamed to the cells through CONTEXT rather than baked into
 * the `columns` closure — the crux of the remount fix (see commission-tariffs-table.tsx):
 * every value here changes on a join or a live what-if estimate, but TanStack's
 * `flexRender` renders each `cell:` AS A COMPONENT, so rebuilding `columns` would give
 * every cell a fresh identity and REMOUNT its subtree — wiping a half-typed custom-price
 * input. Reading these from context keeps `columns` stable.
 *   - `best`         — the row → "En kârlı" winner ('current' | 'plus' | 'custom' | null)
 *   - `selection`    — the ceiling-join per row ('plus' | null)
 *   - `customPrices` — the committed custom price per row
 */
interface RowState {
  best: ReadonlyMap<string, string | null>;
  selection: PlusSelectionMap;
  customPrices: PlusCustomPriceMap;
}

const RowStateContext = React.createContext<RowState>({
  best: new Map(),
  selection: {},
  customPrices: {},
});

/** Current-baseline cell — reads its "En kârlı" flag from context, not the column closure. */
function CurrentCellSlot({ row }: { row: PlusTariffRow }): React.ReactElement {
  const best = React.useContext(RowStateContext).best.get(row.id) ?? null;
  return <PlusCurrentPriceCell row={row} isBest={best === 'current'} />;
}

/**
 * The single Plus offer cell — its "En kârlı" and joined flags both come from context,
 * so a join or live estimate on any row never rebuilds `columns` (which would remount it).
 */
function OfferCellSlot({
  row,
  onToggle,
}: {
  row: PlusTariffRow;
  onToggle: () => void;
}): React.ReactElement {
  const { best, selection, customPrices } = React.useContext(RowStateContext);
  const band = row.bands[0];
  if (band === undefined) return <></>;
  return (
    <PlusBandCell
      row={row}
      band={band}
      isBest={(best.get(row.id) ?? null) === 'plus'}
      // The offer reflects only a PLAIN ceiling join — when a custom price is active
      // the row's join is the custom one, so the offer card does not light up.
      selected={selection[row.id] === 'plus' && customPrices[row.id] == null}
      onSelect={onToggle}
    />
  );
}

/**
 * Custom-price cell — the one whose local input state the remount bug used to wipe. Its
 * "En kârlı" flag, selected flag, and committed price all come from context, so a join
 * or estimate ANYWHERE in the table only re-renders it — the typed input survives.
 */
function CustomCellSlot({
  row,
  onSelect,
  onDeselect,
  onEstimate,
  getDraft,
  onDraftChange,
}: {
  row: PlusTariffRow;
  onSelect: (choice: PlusCustomChoice) => void;
  onDeselect: () => void;
  onEstimate: (rowId: string, netProfit: string | null) => void;
  getDraft: (rowId: string) => string | null | undefined;
  onDraftChange: (rowId: string, price: string | null) => void;
}): React.ReactElement {
  const { best, customPrices } = React.useContext(RowStateContext);
  const committed = customPrices[row.id] ?? null;
  return (
    <PlusCustomPriceCell
      row={row}
      isBest={(best.get(row.id) ?? null) === 'custom'}
      isSelected={committed != null}
      onSelect={onSelect}
      onDeselect={onDeselect}
      onEstimate={onEstimate}
      committedPrice={committed?.price ?? null}
      getDraft={getDraft}
      onDraftChange={onDraftChange}
    />
  );
}

export interface PlusTariffsTableProps {
  rows: readonly PlusTariffRow[];
  /** Ceiling opt-ins (rowId → 'plus'). */
  selection: PlusSelectionMap;
  /** Custom-price opt-ins (rowId → confirmed custom choice), mutually exclusive with `selection`. */
  customPrices: PlusCustomPriceMap;
  /** Live, uncommitted what-if profit per row — feeds only the "En kârlı" race. */
  customEstimates: Record<string, string | null>;
  onToggleJoin: (rowId: string) => void;
  onSelectCustom: (rowId: string, choice: PlusCustomChoice) => void;
  onDeselectCustom: (rowId: string) => void;
  /** Reports a row's live what-if profit (or null when its input clears). */
  onCustomEstimate: (rowId: string, netProfit: string | null) => void;
  /** Reads a row's surviving uncommitted draft price (ref-backed; survives a pagination unmount). */
  getCustomDraft: (rowId: string) => string | null | undefined;
  /** Persists a row's draft price so it survives the cell unmounting. */
  onCustomDraftChange: (rowId: string, price: string | null) => void;
  tabs?: React.ReactNode;
  toolbar?: React.ReactNode;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function PlusTariffsTable({
  rows,
  selection,
  customPrices,
  customEstimates,
  onToggleJoin,
  onSelectCustom,
  onDeselectCustom,
  onCustomEstimate,
  getCustomDraft,
  onCustomDraftChange,
  tabs,
  toolbar,
  hasActiveFilters,
  onClearFilters,
}: PlusTariffsTableProps): React.ReactElement {
  const t = useTranslations('plusCommissionTariffsPage');
  const reasonLabel = usePlusReasonLabel();
  // Local (not persisted): every tariff opens at its normal 100% size; the seller can
  // shrink it to fit for that session.
  const [scale, setScale] = React.useState(TABLE_SCALE_DEFAULT);

  // Resolve the row's single "En kârlı" winner ONCE per row (current, offer, custom).
  // `resolveBestChoice` only ranks already-backend-computed figures — a lookup table,
  // not client-side money math. The custom candidate is the LIVE what-if estimate when
  // present, else the committed custom price — so the badge follows the typed value
  // before it is confirmed.
  const bestById = React.useMemo(
    () =>
      new Map(
        rows.map((r) => [
          r.id,
          resolveBestChoice(r, customEstimates[r.id] ?? customPrices[r.id]?.netProfit ?? null),
        ]),
      ),
    [rows, customPrices, customEstimates],
  );

  const columns = React.useMemo<ColumnDef<PlusTariffRow>[]>(() => {
    const productColumn: ColumnDef<PlusTariffRow> = {
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
            leading={<ProductImageCell url={r.imageUrl} alt={r.productTitle} size="xl" />}
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

    const currentColumn: ColumnDef<PlusTariffRow> = {
      id: 'current',
      header: t('table.current'),
      meta: { label: t('table.current') },
      cell: ({ row }) => <CurrentCellSlot row={row.original} />,
    };

    const offerColumn: ColumnDef<PlusTariffRow> = {
      id: 'offer',
      // Column header: the flame-less "trendyol plus" wordmark + "Fiyat Aralığı".
      // `meta.label` stays plain text for the column-visibility menu + a11y.
      header: () => (
        <span className="gap-2xs flex items-center">
          <TrendyolPlusLockup className="h-3.5" />
          <span className="leading-none">{t('table.priceRange')}</span>
        </span>
      ),
      meta: { label: t('table.plus') },
      cell: ({ row }) => {
        const r = row.original;
        return <OfferCellSlot row={r} onToggle={() => onToggleJoin(r.id)} />;
      },
    };

    const customPriceColumn: ColumnDef<PlusTariffRow> = {
      id: 'customPrice',
      header: t('table.customPrice'),
      meta: { label: t('table.customPrice') },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <CustomCellSlot
            row={r}
            onSelect={(choice) => onSelectCustom(r.id, choice)}
            onDeselect={() => onDeselectCustom(r.id)}
            onEstimate={onCustomEstimate}
            getDraft={getCustomDraft}
            onDraftChange={onCustomDraftChange}
          />
        );
      },
    };

    return [productColumn, currentColumn, offerColumn, customPriceColumn];
    // `columns` identity MUST stay STABLE — the volatile per-row values (best /
    // selection / customPrices) flow through RowStateContext instead. Every dep below is
    // identity-stable: `t`/`reasonLabel` from next-intl, and the handlers from the
    // parent's useCallback([]).
  }, [
    t,
    reasonLabel,
    onToggleJoin,
    onSelectCustom,
    onDeselectCustom,
    onCustomEstimate,
    getCustomDraft,
    onCustomDraftChange,
  ]);

  // Volatile per-row state streamed to the cell slots via context so `columns` stays
  // stable: its value changing re-renders the slots WITHOUT rebuilding `columns`, so
  // cell subtrees — and the custom-price input — are preserved.
  const rowState = React.useMemo<RowState>(
    () => ({ best: bestById, selection, customPrices }),
    [bestById, selection, customPrices],
  );

  return (
    <RowStateContext.Provider value={rowState}>
      <DataTable<PlusTariffRow, unknown>
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
    </RowStateContext.Provider>
  );
}
