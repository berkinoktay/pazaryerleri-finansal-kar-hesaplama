'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { IdentityCell } from '@/components/patterns/identity-cell';
import { ProductImageCell } from '@/components/patterns/product-image-cell';
import { TableScaleControl } from '@/components/patterns/table-scale-control';
import { TABLE_SCALE_DEFAULT } from '@/lib/table-scale';

import type {
  CampaignScenarioPresentation,
  MarketplaceCampaignRow,
} from '../lib/adapt-marketplace-campaign';
import {
  type CampaignCustomPriceMap,
  type CampaignPriceChoice,
  type CampaignSelectionMap,
} from '../lib/marketplace-campaign-selection';
import { MarketplaceCampaignCurrentCell } from './marketplace-campaign-current-cell';
import { MarketplaceCampaignCustomPriceCell } from './marketplace-campaign-custom-price-cell';
import { MarketplaceCampaignMaxPriceCell } from './marketplace-campaign-max-price-cell';

/**
 * Per-row VOLATILE state streamed to the cells through CONTEXT rather than baked into the
 * `columns` closure: TanStack's `flexRender` renders each `cell:` AS A COMPONENT, so rebuilding
 * `columns` on a selection or a keystroke would remount every cell and wipe a half-typed custom
 * price. Reading these from context keeps `columns` stable.
 */
interface RowState {
  presentation: CampaignScenarioPresentation;
  selection: CampaignSelectionMap;
  customPrices: CampaignCustomPriceMap;
}

const RowStateContext = React.createContext<RowState>({
  presentation: 'UNIT',
  selection: {},
  customPrices: {},
});

function MaxCellSlot({
  row,
  onToggle,
}: {
  row: MarketplaceCampaignRow;
  onToggle: () => void;
}): React.ReactElement {
  const { presentation, selection, customPrices } = React.useContext(RowStateContext);
  return (
    <MarketplaceCampaignMaxPriceCell
      row={row}
      presentation={presentation}
      selected={selection[row.id] === 'MAX'}
      customPrice={customPrices[row.id] ?? null}
      onToggle={onToggle}
    />
  );
}

function CustomCellSlot({
  row,
  onToggle,
  onPriceChange,
}: {
  row: MarketplaceCampaignRow;
  onToggle: () => void;
  onPriceChange: (row: MarketplaceCampaignRow, price: string | null) => void;
}): React.ReactElement {
  const { presentation, selection, customPrices } = React.useContext(RowStateContext);
  return (
    <MarketplaceCampaignCustomPriceCell
      row={row}
      presentation={presentation}
      price={customPrices[row.id] ?? null}
      selected={selection[row.id] === 'CUSTOM'}
      onPriceChange={onPriceChange}
      onToggle={onToggle}
    />
  );
}

export interface MarketplaceCampaignItemsTableProps {
  rows: readonly MarketplaceCampaignRow[];
  /** UNIT vs ORDER card framing — backend-decided, fixed for a loaded detail. */
  presentation: CampaignScenarioPresentation;
  selection: CampaignSelectionMap;
  customPrices: CampaignCustomPriceMap;
  /** Toggles one price option for a row (the row travels so the buffer can check its ceiling). */
  onToggleChoice: (row: MarketplaceCampaignRow, choice: CampaignPriceChoice) => void;
  onCustomPriceChange: (row: MarketplaceCampaignRow, price: string | null) => void;
  toolbar?: React.ReactNode;
}

/**
 * The Kampanyalar detail table: one row per product — its identity, the current baseline, the
 * maximum-price card and the custom-price card. Every figure is backend-computed; the cards only
 * render. Rows can reach the hundreds, so the body paginates.
 */
export function MarketplaceCampaignItemsTable({
  rows,
  presentation,
  selection,
  customPrices,
  onToggleChoice,
  onCustomPriceChange,
  toolbar,
}: MarketplaceCampaignItemsTableProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.table');
  // Local (not persisted): every campaign opens at 100%; the seller can shrink it for the session.
  const [scale, setScale] = React.useState(TABLE_SCALE_DEFAULT);

  const columns = React.useMemo<ColumnDef<MarketplaceCampaignRow>[]>(
    () => [
      {
        id: 'product',
        header: t('product'),
        cell: ({ row }) => {
          const r = row.original;
          const meta = [r.brand, r.color, r.size, r.productCode]
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
      },
      {
        id: 'current',
        header: t('currentPrice'),
        meta: { label: t('currentPrice') },
        cell: ({ row }) => <MarketplaceCampaignCurrentCell row={row.original} />,
      },
      {
        id: 'max',
        header: t('maxPrice'),
        meta: { label: t('maxPrice') },
        cell: ({ row }) => (
          <MaxCellSlot row={row.original} onToggle={() => onToggleChoice(row.original, 'MAX')} />
        ),
      },
      {
        id: 'custom',
        header: t('customPrice'),
        meta: { label: t('customPrice') },
        cell: ({ row }) => (
          <CustomCellSlot
            row={row.original}
            onToggle={() => onToggleChoice(row.original, 'CUSTOM')}
            onPriceChange={onCustomPriceChange}
          />
        ),
      },
    ],
    // `columns` identity MUST stay STABLE — the volatile values flow through RowStateContext.
    // Every dep is identity-stable: `t` from next-intl, the handlers from the parent's
    // useCallback([]).
    [t, onToggleChoice, onCustomPriceChange],
  );

  const rowState = React.useMemo<RowState>(
    () => ({ presentation, selection, customPrices }),
    [presentation, selection, customPrices],
  );
  // Fresh array copy for TanStack (it mutates its own row model), stable across unrelated renders.
  const data = React.useMemo(() => [...rows], [rows]);

  return (
    <RowStateContext.Provider value={rowState}>
      <DataTable<MarketplaceCampaignRow, unknown>
        columns={columns}
        data={data}
        getRowId={(row) => row.id}
        initialColumnPinning={{ left: ['product'] }}
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
