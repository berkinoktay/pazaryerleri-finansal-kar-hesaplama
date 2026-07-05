import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { CommissionTariffsTable } from '@/features/campaigns/components/commission-tariffs-table';
import type {
  CustomChoice,
  CustomPriceMap,
  SelectionMap,
} from '@/features/campaigns/lib/bulk-actions';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';
import type { CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

import { render, screen, waitFor, within } from '../helpers/render';
import { HttpResponse, http, server } from '../helpers/msw';

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  tariffId: '00000000-0000-0000-0000-000000000003',
};

const ESTIMATE_ENDPOINT = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/commission-tariffs/${SCOPE.tariffId}/items/:itemId/estimate`;

/** Mock the debounced what-if estimate to resolve with a fixed (winning) profit. */
function mockEstimate(netProfit: string): void {
  server.use(
    http.post(ESTIMATE_ENDPOINT, () =>
      HttpResponse.json({
        itemId: 'r1',
        price: '500.00',
        bandKey: 'band2',
        commissionPct: '13.1',
        calculable: true,
        reason: null,
        breakdown: { netProfit, saleMarginPct: '40.00' },
      }),
    ),
  );
}

// Low band profits so neither a band nor the current price can win the "En kârlı" race —
// the typed custom price (whose live estimate is far higher) is the sole winner.
const band: PriceBand = {
  key: 'band2',
  lowerLimit: '400.00',
  upperLimit: '777.09',
  price: '777.09',
  commissionPct: '13.1',
  netProfit: '10.00',
  marginPct: '2.00',
};

const row: CommissionTariffRow = {
  id: 'r1',
  barcode: '123',
  stockCode: 'M1',
  productTitle: 'Test Ürün',
  imageUrl: null,
  category: 'Bayrak',
  brand: 'Marka',
  currentPrice: '800.00',
  commissionBasePrice: '780.00',
  currentCommissionPct: '19',
  currentNetProfit: '50.00',
  currentMarginPct: '6.25',
  calculable: true,
  reason: null,
  bestBandKey: 'band2',
  selectedBand: null,
  customPrice: null,
  bands: [
    { ...band, key: 'band1', upperLimit: null },
    band,
    { ...band, key: 'band3' },
    { ...band, key: 'band4' },
  ],
};

// Stable references, exactly like the detail-client holds `selection`/`customPrices`
// in useState and its handlers in useCallback. A fresh `{}` or `() => {}` per render
// would land in the `columns` deps and remount every cell on its own — masking whether
// the fix under test (streaming `bestById` through context) actually holds.
const ROWS: readonly CommissionTariffRow[] = [row];
const EMPTY_SELECTION: SelectionMap = {};
const EMPTY_CUSTOM_PRICES: CustomPriceMap = {};
const noop = (): void => {};

/**
 * Mirror of the detail-client's ref-based draft store: uncommitted what-if prices live in
 * a `Map` ref (not state) so they survive a cell unmounting without re-rendering the table
 * on every keystroke. Both callbacks are identity-stable, exactly as the real client's
 * `useCallback([])` handlers, so wiring them here keeps `columns` stable.
 */
function useCustomDraftStore(): {
  getCustomDraft: (rowId: string) => string | null | undefined;
  onCustomDraftChange: (rowId: string, price: string | null) => void;
} {
  const ref = React.useRef(new Map<string, string | null>());
  const getCustomDraft = React.useCallback(
    (rowId: string): string | null | undefined => ref.current.get(rowId),
    [],
  );
  const onCustomDraftChange = React.useCallback((rowId: string, price: string | null): void => {
    ref.current.set(rowId, price);
  }, []);
  return { getCustomDraft, onCustomDraftChange };
}

/**
 * Mirror of the detail-client's live-estimate wiring: it holds `customEstimates` in
 * state and feeds them back through `onCustomEstimate` with the same identity guard.
 * Selection + custom prices stay empty (the seller hasn't committed anything — the
 * bug reproduces during LIVE typing, before any commit re-seeds the input).
 */
function TableHarness(): React.ReactElement {
  const [customEstimates, setCustomEstimates] = React.useState<Record<string, string | null>>({});
  const handleCustomEstimate = React.useCallback(
    (rowId: string, netProfit: string | null): void => {
      setCustomEstimates((prev) =>
        prev[rowId] === netProfit ? prev : { ...prev, [rowId]: netProfit },
      );
    },
    [],
  );
  const { getCustomDraft, onCustomDraftChange } = useCustomDraftStore();
  return (
    <TariffScopeProvider scope={SCOPE}>
      <CommissionTariffsTable
        rows={ROWS}
        selection={EMPTY_SELECTION}
        customPrices={EMPTY_CUSTOM_PRICES}
        customEstimates={customEstimates}
        onSelectBand={noop}
        onSelectCustom={noop}
        onDeselectCustom={noop}
        onCustomEstimate={handleCustomEstimate}
        getCustomDraft={getCustomDraft}
        onCustomDraftChange={onCustomDraftChange}
        hasActiveFilters={false}
        onClearFilters={noop}
      />
    </TariffScopeProvider>
  );
}

/** The custom-price option card (the nearest `TariffOptionCard` above the price input). */
function customCard(): HTMLElement {
  const input = screen.getByPlaceholderText(/fiyat girin/i);
  const card = input.closest('.isolate');
  if (!(card instanceof HTMLElement)) throw new Error('custom price card not found');
  return card;
}

// Two rows so a selection on ROW B can be shown NOT to disturb ROW A's cell state.
// Row A keeps id 'r1' so the shared estimate mock (which echoes itemId 'r1') applies to
// its typed what-if price.
const ROW_A: CommissionTariffRow = { ...row, id: 'r1', productTitle: 'Test Ürün 1' };
const ROW_B: CommissionTariffRow = { ...row, id: 'r2', productTitle: 'Test Ürün 2' };
const TWO_ROWS: readonly CommissionTariffRow[] = [ROW_A, ROW_B];

/** The `<tr>` for the product with the given title. */
function rowByTitle(title: string): HTMLElement {
  const tr = screen.getByText(title).closest('tr');
  if (!(tr instanceof HTMLElement)) throw new Error(`row not found: ${title}`);
  return tr;
}

/** The custom-price option card inside a specific row. */
function customCardIn(rowEl: HTMLElement): HTMLElement {
  const input = within(rowEl).getByPlaceholderText(/fiyat girin/i);
  const card = input.closest('.isolate');
  if (!(card instanceof HTMLElement)) throw new Error('custom price card not found');
  return card;
}

/**
 * Full mirror of the detail-client's edit state: `selection` + `customPrices` in ONE
 * `choices` object, its select/deselect handlers identity-stable `useCallback([])` with
 * functional updates, plus the live-estimate feedback. This is what makes the regression
 * meaningful — a selection on any row drives real state exactly as production does, so
 * the test proves the table survives it without remounting a sibling row's cell.
 */
function StatefulTableHarness({
  rows,
}: {
  rows: readonly CommissionTariffRow[];
}): React.ReactElement {
  const [choices, setChoices] = React.useState<{
    selection: SelectionMap;
    customPrices: CustomPriceMap;
  }>({ selection: {}, customPrices: {} });
  const [customEstimates, setCustomEstimates] = React.useState<Record<string, string | null>>({});

  const handleSelectBand = React.useCallback((rowId: string, band: string): void => {
    setChoices((prev) => {
      const isBoundarySelected = prev.selection[rowId] === band && prev.customPrices[rowId] == null;
      return {
        selection: { ...prev.selection, [rowId]: isBoundarySelected ? null : band },
        customPrices:
          prev.customPrices[rowId] == null
            ? prev.customPrices
            : { ...prev.customPrices, [rowId]: null },
      };
    });
  }, []);
  const handleSelectCustom = React.useCallback(
    (rowId: string, band: string, choice: CustomChoice): void => {
      setChoices((prev) => ({
        selection: { ...prev.selection, [rowId]: band },
        customPrices: { ...prev.customPrices, [rowId]: choice },
      }));
    },
    [],
  );
  const handleDeselectCustom = React.useCallback((rowId: string): void => {
    setChoices((prev) => ({
      selection:
        prev.selection[rowId] == null ? prev.selection : { ...prev.selection, [rowId]: null },
      customPrices:
        prev.customPrices[rowId] == null
          ? prev.customPrices
          : { ...prev.customPrices, [rowId]: null },
    }));
  }, []);
  const handleCustomEstimate = React.useCallback(
    (rowId: string, netProfit: string | null): void => {
      setCustomEstimates((prev) =>
        prev[rowId] === netProfit ? prev : { ...prev, [rowId]: netProfit },
      );
    },
    [],
  );
  const { getCustomDraft, onCustomDraftChange } = useCustomDraftStore();

  return (
    <TariffScopeProvider scope={SCOPE}>
      <CommissionTariffsTable
        rows={rows}
        selection={choices.selection}
        customPrices={choices.customPrices}
        customEstimates={customEstimates}
        onSelectBand={handleSelectBand}
        onSelectCustom={handleSelectCustom}
        onDeselectCustom={handleDeselectCustom}
        onCustomEstimate={handleCustomEstimate}
        getCustomDraft={getCustomDraft}
        onCustomDraftChange={onCustomDraftChange}
        hasActiveFilters={false}
        onClearFilters={noop}
      />
    </TariffScopeProvider>
  );
}

describe('CommissionTariffsTable — live what-if estimate', () => {
  it('keeps the typed custom price when a live estimate lands (remount regression)', async () => {
    // The winning figure — far above the current price + every band, so once the live
    // estimate returns the "En kârlı" marker moves to the custom card.
    mockEstimate('345.00');
    const { user } = render(<TableHarness />);

    // Type a what-if price. Reporting the live estimate back up used to rebuild the
    // TanStack `columns`, which remounted the cell and wiped this very input mid-type.
    const input = screen.getByPlaceholderText(/fiyat girin/i);
    await user.type(input, '500');

    // Wait until the live estimate lands and crowns the custom card the winner.
    await waitFor(() => expect(within(customCard()).getByText(/en kârlı/i)).toBeInTheDocument(), {
      timeout: 3000,
    });

    // The bug's fingerprint: with the remount, this assertion failed because the input
    // reset to empty the instant the estimate returned. It must still hold "500".
    expect(screen.getByDisplayValue('500')).toBeInTheDocument();
  });
});

describe('CommissionTariffsTable — a selection never remounts a sibling row', () => {
  it("keeps ROW A's half-typed custom price when ROW B selects a band", async () => {
    // ROW A's live estimate wins its row (far above current + every band) so we can
    // wait on the badge landing in its custom card — proof the estimate has resolved.
    mockEstimate('345.00');
    const { user } = render(<StatefulTableHarness rows={TWO_ROWS} />);

    // Type a what-if price into ROW A's custom input (uncommitted draft — the bug wiped
    // exactly this, since an uncommitted draft has no committed price to re-seed from).
    const inputA = within(rowByTitle('Test Ürün 1')).getByPlaceholderText(/fiyat girin/i);
    await user.type(inputA, '500');

    // Wait until ROW A's estimate resolves and crowns its custom card the winner.
    await waitFor(
      () =>
        expect(
          within(customCardIn(rowByTitle('Test Ürün 1'))).getByText(/en kârlı/i),
        ).toBeInTheDocument(),
      { timeout: 3000 },
    );

    // Select a band on ROW B. This updates `selection` in the harness — the trigger that
    // (with the bug) rebuilt the table columns and remounted EVERY cell, wiping ROW A's
    // still-open input.
    const rowBBands = within(rowByTitle('Test Ürün 2')).getAllByRole('button', {
      name: /bu aralığı seç/i,
    });
    await user.click(rowBBands[0]);

    // ROW A's draft must survive a selection made on ROW B.
    expect(within(rowByTitle('Test Ürün 1')).getByDisplayValue('500')).toBeInTheDocument();
  });

  it("keeps ROW A's COMMITTED custom price and its estimate when ROW B selects a band", async () => {
    mockEstimate('345.00');
    const { user } = render(<StatefulTableHarness rows={TWO_ROWS} />);

    // Type, wait for the estimate to derive a band, then COMMIT the custom price.
    const inputA = within(rowByTitle('Test Ürün 1')).getByPlaceholderText(/fiyat girin/i);
    await user.type(inputA, '500');
    await waitFor(
      () =>
        expect(
          within(rowByTitle('Test Ürün 1')).getByRole('button', { name: /bu fiyatı seç/i }),
        ).toBeEnabled(),
      { timeout: 3000 },
    );
    await user.click(
      within(rowByTitle('Test Ürün 1')).getByRole('button', { name: /bu fiyatı seç/i }),
    );
    // Committed → the custom foot now reads "Seçildi".
    expect(
      within(rowByTitle('Test Ürün 1')).getByRole('button', { name: /seçildi/i }),
    ).toBeInTheDocument();

    // Select a band on ROW B.
    const rowBBands = within(rowByTitle('Test Ürün 2')).getAllByRole('button', {
      name: /bu aralığı seç/i,
    });
    await user.click(rowBBands[0]);

    // The committed amount survives, and — because the cell re-rendered rather than
    // remounting — so does its live estimate (the derived-band hint), which a remount
    // would have dropped to null until the next debounce.
    const rowAAfter = rowByTitle('Test Ürün 1');
    expect(within(rowAAfter).getByDisplayValue('500')).toBeInTheDocument();
    expect(within(rowAAfter).getByText(/2\. Fiyat Aralığı/i)).toBeInTheDocument();
  });
});

// A row whose SERVER value is a custom price — proves a deliberate clear (null draft)
// beats even a persisted seed on remount, not just an absent one.
const SEEDED_ROW: CommissionTariffRow = { ...row, id: 'r1', customPrice: '150.00' };

/**
 * Conditionally mounts the table behind a toggle button — the exact thing DataTable
 * pagination does to off-page rows (and a filter / tab switch does to the whole set):
 * it UNMOUNTS the cell, wiping its local input state. The ref-based draft store lives
 * in this harness (above the toggle), so it outlives the table and re-seeds the input on
 * remount. `customEstimates` also lives here, mirroring the detail-client's ownership.
 */
function DraftPersistenceHarness({
  rows,
}: {
  rows: readonly CommissionTariffRow[];
}): React.ReactElement {
  const { getCustomDraft, onCustomDraftChange } = useCustomDraftStore();
  const [customEstimates, setCustomEstimates] = React.useState<Record<string, string | null>>({});
  const handleCustomEstimate = React.useCallback(
    (rowId: string, netProfit: string | null): void => {
      setCustomEstimates((prev) =>
        prev[rowId] === netProfit ? prev : { ...prev, [rowId]: netProfit },
      );
    },
    [],
  );
  const [mounted, setMounted] = React.useState(true);
  return (
    <TariffScopeProvider scope={SCOPE}>
      <button type="button" onClick={() => setMounted((prev) => !prev)}>
        toggle
      </button>
      {mounted ? (
        <CommissionTariffsTable
          rows={rows}
          selection={EMPTY_SELECTION}
          customPrices={EMPTY_CUSTOM_PRICES}
          customEstimates={customEstimates}
          onSelectBand={noop}
          onSelectCustom={noop}
          onDeselectCustom={noop}
          onCustomEstimate={handleCustomEstimate}
          getCustomDraft={getCustomDraft}
          onCustomDraftChange={onCustomDraftChange}
          hasActiveFilters={false}
          onClearFilters={noop}
        />
      ) : null}
    </TariffScopeProvider>
  );
}

describe('CommissionTariffsTable — draft survives a pagination unmount', () => {
  it('restores a still-typed, uncommitted custom price after an unmount/remount', async () => {
    mockEstimate('345.00');
    const { user } = render(<DraftPersistenceHarness rows={ROWS} />);

    // Type an uncommitted what-if price (no committed/server value backs it — the exact
    // case the bug lost, since only a committed price used to re-seed).
    await user.type(screen.getByPlaceholderText(/fiyat girin/i), '500');
    expect(screen.getByDisplayValue('500')).toBeInTheDocument();

    // Unmount the whole table (what pagination does to off-page rows) …
    await user.click(screen.getByRole('button', { name: /toggle/i }));
    expect(screen.queryByPlaceholderText(/fiyat girin/i)).toBeNull();

    // … then bring it back. The draft, kept in the parent's ref, re-seeds the input.
    await user.click(screen.getByRole('button', { name: /toggle/i }));
    expect(screen.getByDisplayValue('500')).toBeInTheDocument();
  });

  it('keeps a deliberately-cleared input empty across an unmount/remount, ignoring the server price', async () => {
    mockEstimate('345.00');
    // The row's server value is a custom price (150), so the input mounts pre-filled.
    const { user } = render(<DraftPersistenceHarness rows={[SEEDED_ROW]} />);
    const input = screen.getByPlaceholderText(/fiyat girin/i);
    expect(input).toHaveValue('150');

    // Clear it — a deliberate clear recorded as a null draft.
    await user.clear(input);

    // Unmount + remount.
    await user.click(screen.getByRole('button', { name: /toggle/i }));
    await user.click(screen.getByRole('button', { name: /toggle/i }));

    // The null draft wins over the persisted 150 — the remount stays empty.
    expect(screen.getByPlaceholderText(/fiyat girin/i)).toHaveValue('');
  });
});
