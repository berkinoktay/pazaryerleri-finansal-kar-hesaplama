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

import type {
  AdvantageBand,
  AdvantageTariffRow,
  NonNullStarTierKey,
} from '../lib/adapt-advantage-tariff';
import {
  bandForKey,
  type AdvantageCustomChoice,
  type AdvantageCustomPriceMap,
  type AdvantageSelectionMap,
} from '../lib/advantage-bulk-actions';
import { resolveBestChoice } from '../lib/best-choice';
import { AdvantageCurrentCell } from './advantage-current-cell';
import { AdvantageCustomPriceCell } from './advantage-custom-price-cell';
import { AdvantageTierCell } from './advantage-tier-cell';

const DASH = '—';

/** Column render order for the three star tiers — Avantaj → Çok Avantaj → Süper Avantaj. */
const TIER_KEYS = ['tier1', 'tier2', 'tier3'] as const satisfies readonly NonNullStarTierKey[];

/**
 * Per-row VOLATILE state streamed to the cells through CONTEXT rather than baked into the
 * `columns` closure — the crux of the remount fix (see commission-tariffs-table.tsx): every
 * value here changes on a selection or a live what-if estimate, but TanStack's `flexRender`
 * renders each `cell:` AS A COMPONENT, so rebuilding `columns` would give every cell a
 * fresh identity and REMOUNT its subtree — wiping a half-typed custom-price input. Reading
 * these from context keeps `columns` stable.
 *   - `best`         — the row → "En kârlı" winner ('current' | tier key | 'custom' | null)
 *   - `selection`    — the chosen tier per row (drives which tier card lights up)
 *   - `customPrices` — the committed custom price per row
 */
interface RowState {
  best: ReadonlyMap<string, string | null>;
  selection: AdvantageSelectionMap;
  customPrices: AdvantageCustomPriceMap;
}

const RowStateContext = React.createContext<RowState>({
  best: new Map(),
  selection: {},
  customPrices: {},
});

/** Current-baseline cell — reads its "En kârlı" flag from context, not the column closure. */
function CurrentCellSlot({ row }: { row: AdvantageTariffRow }): React.ReactElement {
  const best = React.useContext(RowStateContext).best.get(row.id) ?? null;
  return <AdvantageCurrentCell row={row} isBest={best === 'current'} />;
}

/**
 * One star-tier cell — its "En kârlı" and selected flags both come from context, so a
 * selection or live estimate on any row never rebuilds `columns` (which would remount it).
 */
function TierCellSlot({
  row,
  band,
  onSelect,
}: {
  row: AdvantageTariffRow;
  band: AdvantageBand;
  onSelect: () => void;
}): React.ReactElement {
  const { best, selection, customPrices } = React.useContext(RowStateContext);
  return (
    <AdvantageTierCell
      row={row}
      band={band}
      isBest={(best.get(row.id) ?? null) === band.key}
      // A tier reflects only a PLAIN choice — when a custom price is active it is the row's
      // join instead, so the tier card does not light up.
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
  row: AdvantageTariffRow;
  onSelect: (choice: AdvantageCustomChoice) => void;
  onDeselect: () => void;
  onEstimate: (rowId: string, netProfit: string | null) => void;
  getDraft: (rowId: string) => string | null | undefined;
  onDraftChange: (rowId: string, price: string | null) => void;
}): React.ReactElement {
  const { best, customPrices } = React.useContext(RowStateContext);
  const committed = customPrices[row.id] ?? null;
  return (
    <AdvantageCustomPriceCell
      row={row}
      isBest={(best.get(row.id) ?? null) === 'custom'}
      isSelected={committed != null}
      onSelect={onSelect}
      onDeselect={onDeselect}
      onEstimate={onEstimate}
      committedPrice={committed?.price ?? null}
      committedNetProfit={committed?.netProfit ?? null}
      committedMarginPct={committed?.marginPct ?? null}
      getDraft={getDraft}
      onDraftChange={onDraftChange}
    />
  );
}

export interface AdvantageTariffsTableProps {
  rows: readonly AdvantageTariffRow[];
  /** Tier opt-ins (rowId → chosen tier). */
  selection: AdvantageSelectionMap;
  /** Custom-price opt-ins (rowId → confirmed custom choice), mutually exclusive with `selection`. */
  customPrices: AdvantageCustomPriceMap;
  /** Live, uncommitted what-if profit per row — feeds only the "En kârlı" race. */
  customEstimates: Record<string, string | null>;
  onSelectTier: (rowId: string, key: NonNullStarTierKey) => void;
  onSelectCustom: (rowId: string, choice: AdvantageCustomChoice) => void;
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

export function AdvantageTariffsTable({
  rows,
  selection,
  customPrices,
  customEstimates,
  onSelectTier,
  onSelectCustom,
  onDeselectCustom,
  onCustomEstimate,
  getCustomDraft,
  onCustomDraftChange,
  toolbar,
  hasActiveFilters,
  onClearFilters,
}: AdvantageTariffsTableProps): React.ReactElement {
  const t = useTranslations('productLabelsPage');
  const tTier = useTranslations('productLabelsPage.tier');
  // Local (not persisted): every tariff opens at its normal 100% size; the seller can
  // shrink it to fit for that session.
  const [scale, setScale] = React.useState(TABLE_SCALE_DEFAULT);

  // Resolve the row's single "En kârlı" winner ONCE per row (current, a tier, custom).
  // `resolveBestChoice` only ranks already-backend-computed figures — a lookup table, not
  // client-side money math. The custom candidate is the LIVE what-if estimate when present,
  // else the committed custom price — so the badge follows the typed value before it is
  // confirmed. The backend `bestTierKey` / `current.isBest` flags are NOT read here; the
  // whole-row winner is resolved holistically on the client instead.
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

  const columns = React.useMemo<ColumnDef<AdvantageTariffRow>[]>(() => {
    const productColumn: ColumnDef<AdvantageTariffRow> = {
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

    const currentColumn: ColumnDef<AdvantageTariffRow> = {
      id: 'current',
      // The current baseline uses the SAME price + commission + ProfitBadge treatment as
      // the tier columns (via AdvantageCurrentCell) so the seller compares "do nothing"
      // against each advantage tier on identical terms. Left-aligned like the tier cards.
      header: t('table.displayPrice'),
      meta: { label: t('table.displayPrice') },
      cell: ({ row }) => <CurrentCellSlot row={row.original} />,
    };

    const tierColumns: ColumnDef<AdvantageTariffRow>[] = TIER_KEYS.map((key) => ({
      id: key,
      header: tTier(key),
      meta: { label: tTier(key) },
      cell: ({ row }) => {
        const r = row.original;
        const band = bandForKey(r, key);
        // A row need not carry every tier — an absent tier keeps a mute em-dash so the
        // present tiers stay aligned across the columns.
        if (band === undefined) {
          return <div className="text-muted-foreground text-sm">{DASH}</div>;
        }
        return <TierCellSlot row={r} band={band} onSelect={() => onSelectTier(r.id, key)} />;
      },
    }));

    const customPriceColumn: ColumnDef<AdvantageTariffRow> = {
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

    return [productColumn, currentColumn, ...tierColumns, customPriceColumn];
    // `columns` identity MUST stay STABLE — the volatile per-row values (best / selection /
    // customPrices) flow through RowStateContext instead. Every dep below is
    // identity-stable: `t`/`tTier` from next-intl, and the handlers from the
    // parent's useCallback([]).
  }, [
    t,
    tTier,
    onSelectTier,
    onSelectCustom,
    onDeselectCustom,
    onCustomEstimate,
    getCustomDraft,
    onCustomDraftChange,
  ]);

  // Volatile per-row state streamed to the cell slots via context so `columns` stays stable:
  // its value changing re-renders the slots WITHOUT rebuilding `columns`, so cell subtrees —
  // and the custom-price input — are preserved.
  const rowState = React.useMemo<RowState>(
    () => ({ best: bestById, selection, customPrices }),
    [bestById, selection, customPrices],
  );

  return (
    <RowStateContext.Provider value={rowState}>
      <DataTable<AdvantageTariffRow, unknown>
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
