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

import { resolveBestChoice } from '../lib/best-choice';
import type { CustomChoice, CustomPriceMap, SelectionMap } from '../lib/bulk-actions';
import type { CommissionTariffRow, PriceBand } from '../types';
import { CurrentPriceCell } from './current-price-cell';
import { CustomPriceCell } from './custom-price-cell';
import { PriceBandCell } from './price-band-cell';

const BAND_INDEXES = [0, 1, 2, 3] as const;

/**
 * Per-row VOLATILE state streamed to the cells through CONTEXT rather than baked into
 * the `columns` closure. This is the crux of the remount fix: every one of these values
 * changes on a selection or a live what-if estimate, but TanStack's `flexRender` renders
 * each `cell:` function AS A COMPONENT (`<Cell {...ctx} />`), so rebuilding `columns`
 * gives every cell a fresh identity and React REMOUNTS its subtree — wiping a
 * half-typed custom-price input. Reading these from context keeps `columns` stable, so a
 * selection or estimate on ANY row only RE-RENDERS the cells (never remounts them).
 *   - `best`         — the row → "En kârlı" winner ('current' | band key | 'custom' | null)
 *   - `selection`    — the chosen band per row (drives which band card lights up)
 *   - `customPrices` — the committed custom price per row (drives the custom card state)
 */
interface RowState {
  best: ReadonlyMap<string, string | null>;
  selection: SelectionMap;
  customPrices: CustomPriceMap;
}

const RowStateContext = React.createContext<RowState>({
  best: new Map(),
  selection: {},
  customPrices: {},
});

/** Current-baseline cell — reads its "En kârlı" flag from context, not the column closure. */
function CurrentCellSlot({ row }: { row: CommissionTariffRow }): React.ReactElement {
  const best = React.useContext(RowStateContext).best.get(row.id) ?? null;
  return <CurrentPriceCell row={row} isBest={best === 'current'} />;
}

/**
 * One price-band cell — its "En kârlı" and selected flags both come from context, so a
 * selection or live estimate on any row never rebuilds `columns` (which would remount it).
 */
function BandCellSlot({
  row,
  band,
  onSelect,
}: {
  row: CommissionTariffRow;
  band: PriceBand;
  onSelect: (key: string) => void;
}): React.ReactElement {
  const { best, selection, customPrices } = React.useContext(RowStateContext);
  return (
    <PriceBandCell
      row={row}
      band={band}
      isBest={(best.get(row.id) ?? null) === band.key}
      // A band reflects only a PLAIN boundary choice — when a custom price is active it
      // drives the derived band, so no band lights up.
      selected={selection[row.id] === band.key && customPrices[row.id] == null}
      onSelect={onSelect}
    />
  );
}

/**
 * Custom-price cell — the one whose local `price`/`lastResult` state the remount bug
 * used to wipe. Its "En kârlı" flag, selected flag, and committed price all come from
 * context, so a selection or estimate ANYWHERE in the table only re-renders it — the
 * typed input (its own local state) survives.
 */
function CustomCellSlot({
  row,
  onSelect,
  onDeselect,
  onEstimate,
  getDraft,
  onDraftChange,
}: {
  row: CommissionTariffRow;
  onSelect: (band: string, choice: CustomChoice) => void;
  onDeselect: () => void;
  onEstimate: (rowId: string, netProfit: string | null) => void;
  getDraft: (rowId: string) => string | null | undefined;
  onDraftChange: (rowId: string, price: string | null) => void;
}): React.ReactElement {
  const { best, customPrices } = React.useContext(RowStateContext);
  const committed = customPrices[row.id] ?? null;
  return (
    <CustomPriceCell
      row={row}
      isBest={(best.get(row.id) ?? null) === 'custom'}
      isSelected={committed != null}
      onSelect={onSelect}
      onDeselect={onDeselect}
      onEstimate={onEstimate}
      committedPrice={committed?.price ?? null}
      committedNetProfit={committed?.netProfit ?? null}
      committedMarginPct={committed?.marginPct ?? null}
      // Ref-backed draft store: keeps an uncommitted what-if price alive when pagination
      // (or a filter / tab switch) unmounts this cell and later remounts it.
      getDraft={getDraft}
      onDraftChange={onDraftChange}
    />
  );
}

export interface CommissionTariffsTableProps {
  rows: readonly CommissionTariffRow[];
  selection: SelectionMap;
  /** Custom-price opt-ins (rowId → confirmed custom choice). */
  customPrices: CustomPriceMap;
  /** Live, uncommitted what-if profit per row — feeds only the "En kârlı" race. */
  customEstimates: Record<string, string | null>;
  onSelectBand: (rowId: string, band: string) => void;
  onSelectCustom: (rowId: string, band: string, choice: CustomChoice) => void;
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

export function CommissionTariffsTable({
  rows,
  selection,
  customPrices,
  customEstimates,
  onSelectBand,
  onSelectCustom,
  onDeselectCustom,
  onCustomEstimate,
  getCustomDraft,
  onCustomDraftChange,
  tabs,
  toolbar,
  hasActiveFilters,
  onClearFilters,
}: CommissionTariffsTableProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  // Local (not persisted): every tariff opens at its normal 100% size; the
  // seller can shrink it to fit for that session.
  const [scale, setScale] = React.useState(TABLE_SCALE_DEFAULT);

  // Resolve the row's single "En kârlı" winner ONCE per row (not once per cell): the
  // current, band, and custom cells all read the same result by row id (the mobile
  // layout already computes it once per card). `resolveBestChoice` only ranks
  // already-backend-computed figures — a lookup table, not client-side money math.
  // The custom candidate is the LIVE what-if estimate when present, else the committed
  // custom price — so the badge follows the typed value before it is confirmed.
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
            leading={<ProductImageCell url={r.imageUrl} alt={r.productTitle} size="xl" />}
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

    const currentColumn: ColumnDef<CommissionTariffRow> = {
      id: 'current',
      // Left-aligned like the band + custom cards (design preference).
      header: t('table.current'),
      meta: { label: t('table.current') },
      // The slot reads the whole-row "En kârlı" winner from context, so this closure
      // stays stable across live estimates and the cell never remounts.
      cell: ({ row }) => <CurrentCellSlot row={row.original} />,
    };

    const bandColumns: ColumnDef<CommissionTariffRow>[] = BAND_INDEXES.map((i) => ({
      id: `band${i + 1}`,
      header: t('table.band', { n: i + 1 }),
      meta: { label: t('table.band', { n: i + 1 }) },
      cell: ({ row }) => {
        const r = row.original;
        const band = r.bands[i];
        if (band === undefined) return null;
        return <BandCellSlot row={r} band={band} onSelect={(key) => onSelectBand(r.id, key)} />;
      },
    }));

    const customPriceColumn: ColumnDef<CommissionTariffRow> = {
      id: 'customPrice',
      header: t('table.customPrice'),
      meta: { label: t('table.customPrice') },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <CustomCellSlot
            row={r}
            onSelect={(band, choice) => onSelectCustom(r.id, band, choice)}
            onDeselect={() => onDeselectCustom(r.id)}
            // Stable parent handler passed straight through (the cell reports its own
            // rowId) so the debounced estimate effect isn't reset every render.
            onEstimate={onCustomEstimate}
            // Ref-backed draft store. Both handlers are identity-stable, so adding them to
            // the `columns` deps below does NOT break column identity (see the note there).
            getDraft={getCustomDraft}
            onDraftChange={onCustomDraftChange}
          />
        );
      },
    };

    return [productColumn, currentColumn, ...bandColumns, customPriceColumn];
    // `columns` identity MUST stay STABLE — the volatile per-row values (best /
    // selection / customPrices) flow through RowStateContext instead. Adding any
    // volatile value here rebuilds `columns`, and because flexRender renders each
    // `cell:` as a component, React remounts every cell and wipes half-typed
    // custom-price drafts (see the remount regressions in
    // commission-tariffs-table.test.tsx). Every dep below is identity-stable:
    // `t` from next-intl, and the handlers (select/deselect/estimate + the
    // ref-backed draft getter/setter) from the parent's useCallback([]).
  }, [
    t,
    onSelectBand,
    onSelectCustom,
    onDeselectCustom,
    onCustomEstimate,
    getCustomDraft,
    onCustomDraftChange,
  ]);

  // Volatile per-row state streamed to the cell slots via context so `columns` stays
  // stable (see RowStateContext): its value changing re-renders the slots WITHOUT
  // rebuilding `columns`, so cell subtrees — and the custom-price input — are preserved.
  const rowState = React.useMemo<RowState>(
    () => ({ best: bestById, selection, customPrices }),
    [bestById, selection, customPrices],
  );

  return (
    // Provider streams the volatile row state to every cell slot; its value changing
    // re-renders the slots WITHOUT rebuilding `columns`, so cell subtrees are preserved.
    <RowStateContext.Provider value={rowState}>
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
    </RowStateContext.Provider>
  );
}
