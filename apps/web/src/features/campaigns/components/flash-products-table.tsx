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

import { useFlashReasonLabel } from '../hooks/use-flash-reason-label';
import type { FlashBand, FlashOfferKey, FlashProductRow } from '../lib/adapt-flash-product';
import {
  bandForKey,
  type FlashCustomChoice,
  type FlashCustomPriceMap,
  type FlashSelectionMap,
} from '../lib/flash-bulk-actions';
import { resolveBestChoice } from '../lib/best-choice';
import { FlashCurrentCell } from './flash-current-cell';
import { FlashCustomPriceCell } from './flash-custom-price-cell';
import { FlashProductOfferCell } from './flash-product-offer-cell';

const DASH = '—';

/** Column render order for the two flash offers — 24 Saatlik → 3 Saatlik. */
const OFFER_KEYS = ['h24', 'h3'] as const satisfies readonly FlashOfferKey[];

/**
 * Per-row VOLATILE state streamed to the cells through CONTEXT rather than baked into the
 * `columns` closure — the crux of the remount fix: every value here changes on a selection
 * or a live what-if estimate, but TanStack's `flexRender` renders each `cell:` AS A
 * COMPONENT, so rebuilding `columns` would give every cell a fresh identity and REMOUNT its
 * subtree — wiping a half-typed custom-price input. Reading these from context keeps
 * `columns` stable.
 *   - `best`         — the row → "En kârlı" winner ('current' | offer key | 'custom' | null)
 *   - `selection`    — the chosen offer per row (drives which offer card lights up)
 *   - `customPrices` — the committed custom price per row
 */
interface RowState {
  best: ReadonlyMap<string, string | null>;
  selection: FlashSelectionMap;
  customPrices: FlashCustomPriceMap;
}

const RowStateContext = React.createContext<RowState>({
  best: new Map(),
  selection: {},
  customPrices: {},
});

/** Current-baseline cell — reads its "En kârlı" flag from context, not the column closure. */
function CurrentCellSlot({ row }: { row: FlashProductRow }): React.ReactElement {
  const best = React.useContext(RowStateContext).best.get(row.id) ?? null;
  return <FlashCurrentCell row={row} isBest={best === 'current'} />;
}

/**
 * One flash-offer cell — its "En kârlı" and selected flags both come from context, so a
 * selection or live estimate on any row never rebuilds `columns` (which would remount it).
 */
function OfferCellSlot({
  row,
  band,
  slotLabel,
  onSelect,
}: {
  row: FlashProductRow;
  band: FlashBand;
  slotLabel: string;
  onSelect: () => void;
}): React.ReactElement {
  const { best, selection, customPrices } = React.useContext(RowStateContext);
  return (
    <FlashProductOfferCell
      row={row}
      band={band}
      slotLabel={slotLabel}
      isBest={(best.get(row.id) ?? null) === band.key}
      // An offer reflects only a PLAIN choice — when a custom price is active it is the
      // row's join instead, so the offer card does not light up.
      selected={selection[row.id] === band.key && customPrices[row.id] == null}
      onSelect={onSelect}
    />
  );
}

/**
 * Custom-price cell — the one whose local input state the remount bug used to wipe. Its
 * "En kârlı" flag, selected flag, and committed price all come from context, so a selection
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
  row: FlashProductRow;
  onSelect: (choice: FlashCustomChoice) => void;
  onDeselect: () => void;
  onEstimate: (rowId: string, netProfit: string | null) => void;
  getDraft: (rowId: string) => string | null | undefined;
  onDraftChange: (rowId: string, price: string | null) => void;
}): React.ReactElement {
  const { best, customPrices } = React.useContext(RowStateContext);
  const committed = customPrices[row.id] ?? null;
  return (
    <FlashCustomPriceCell
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

export interface FlashProductsTableProps {
  rows: readonly FlashProductRow[];
  /** Offer opt-ins (rowId → chosen offer). */
  selection: FlashSelectionMap;
  /** Custom-price opt-ins (rowId → confirmed custom choice), mutually exclusive with `selection`. */
  customPrices: FlashCustomPriceMap;
  /** Live, uncommitted what-if profit per row — feeds only the "En kârlı" race. */
  customEstimates: Record<string, string | null>;
  /**
   * Whether ANY row in the FULL list carries a 24h / 3h offer — the column is not rendered
   * at all when none do (Berkin's rule). Computed over the unfiltered set so a filter never
   * makes a column blink in and out.
   */
  showOffer24: boolean;
  showOffer3: boolean;
  onSelectOffer: (rowId: string, key: FlashOfferKey) => void;
  onSelectCustom: (rowId: string, choice: FlashCustomChoice) => void;
  onDeselectCustom: (rowId: string) => void;
  /** Reports a row's live what-if profit (or null when its input clears). */
  onCustomEstimate: (rowId: string, netProfit: string | null) => void;
  /** Reads a row's surviving uncommitted draft price (ref-backed; survives a pagination unmount). */
  getCustomDraft: (rowId: string) => string | null | undefined;
  /** Persists a row's draft price so it survives the cell unmounting. */
  onCustomDraftChange: (rowId: string, price: string | null) => void;
  toolbar?: React.ReactNode;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function FlashProductsTable({
  rows,
  selection,
  customPrices,
  customEstimates,
  showOffer24,
  showOffer3,
  onSelectOffer,
  onSelectCustom,
  onDeselectCustom,
  onCustomEstimate,
  getCustomDraft,
  onCustomDraftChange,
  toolbar,
  hasActiveFilters,
  onClearFilters,
}: FlashProductsTableProps): React.ReactElement {
  const t = useTranslations('flashProductsPage');
  const tSlot = useTranslations('flashProductsPage.slot');
  const reasonLabel = useFlashReasonLabel();
  // Local (not persisted): every list opens at its normal 100% size; the seller can shrink
  // it to fit for that session.
  const [scale, setScale] = React.useState(TABLE_SCALE_DEFAULT);

  // Resolve the row's single "En kârlı" winner ONCE per row (current, an offer, custom).
  // `resolveBestChoice` only ranks already-backend-computed figures — a lookup table, not
  // client-side money math. The custom candidate is the LIVE what-if estimate when present,
  // else the committed custom price — so the badge follows the typed value before it is
  // confirmed.
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

  const columns = React.useMemo<ColumnDef<FlashProductRow>[]>(() => {
    const productColumn: ColumnDef<FlashProductRow> = {
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
                {r.modelCode !== null ? (
                  <span className="truncate tabular-nums">{r.modelCode}</span>
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

    const currentColumn: ColumnDef<FlashProductRow> = {
      id: 'current',
      // The current baseline uses the SAME price + commission + ProfitBadge treatment as
      // the offer columns (via FlashCurrentCell) so the seller compares "do nothing"
      // against each flash offer on identical terms.
      header: t('table.displayPrice'),
      meta: { label: t('table.displayPrice') },
      cell: ({ row }) => <CurrentCellSlot row={row.original} />,
    };

    // The offer columns present in the file. Column visibility is Berkin's rule: a 24h /
    // 3h column is rendered only when at least one row carries that offer, symmetric per
    // slot — computed over the FULL set, so a filter never toggles a column.
    const OFFER_VISIBLE: Record<FlashOfferKey, boolean> = { h24: showOffer24, h3: showOffer3 };
    const offerColumns: ColumnDef<FlashProductRow>[] = OFFER_KEYS.filter(
      (key) => OFFER_VISIBLE[key],
    ).map((key) => ({
      id: key,
      header: tSlot(key),
      meta: { label: tSlot(key) },
      cell: ({ row }) => {
        const r = row.original;
        const band = bandForKey(r, key);
        // A row need not carry both offers — an absent offer keeps a mute em-dash so the
        // present offers stay aligned across the columns.
        if (band === undefined) {
          return <div className="text-muted-foreground text-sm">{DASH}</div>;
        }
        return (
          <OfferCellSlot
            row={r}
            band={band}
            slotLabel={tSlot(key)}
            onSelect={() => onSelectOffer(r.id, key)}
          />
        );
      },
    }));

    const customPriceColumn: ColumnDef<FlashProductRow> = {
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

    return [productColumn, currentColumn, ...offerColumns, customPriceColumn];
    // `columns` identity MUST stay STABLE — the volatile per-row values (best / selection /
    // customPrices) flow through RowStateContext instead. Every dep below is
    // identity-stable: `t`/`tSlot`/`reasonLabel` from next-intl, the handlers from the
    // parent's useCallback([]), and the two show flags (primitives, only change with data).
  }, [
    t,
    tSlot,
    reasonLabel,
    showOffer24,
    showOffer3,
    onSelectOffer,
    onSelectCustom,
    onDeselectCustom,
    onCustomEstimate,
    getCustomDraft,
    onCustomDraftChange,
  ]);

  // Volatile per-row state streamed to the cell slots via context so `columns` stays
  // stable: its value changing re-renders the slots WITHOUT rebuilding `columns`, so cell
  // subtrees — and the custom-price input — are preserved.
  const rowState = React.useMemo<RowState>(
    () => ({ best: bestById, selection, customPrices }),
    [bestById, selection, customPrices],
  );

  return (
    <RowStateContext.Provider value={rowState}>
      <DataTable<FlashProductRow, unknown>
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
    </RowStateContext.Provider>
  );
}
