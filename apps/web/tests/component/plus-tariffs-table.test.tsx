import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { PlusTariffsTable } from '@/features/campaigns/components/plus-tariffs-table';
import type { PlusBand, PlusTariffRow } from '@/features/campaigns/lib/adapt-plus-tariff';
import type {
  PlusCustomChoice,
  PlusCustomPriceMap,
  PlusSelectionMap,
  PlusSelectionState,
} from '@/features/campaigns/lib/plus-bulk-actions';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';

import { render, screen, waitFor, within } from '../helpers/render';
import { HttpResponse, http, server } from '../helpers/msw';

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  tariffId: '00000000-0000-0000-0000-000000000003',
};

const ESTIMATE_ENDPOINT = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/plus-commission-tariffs/${SCOPE.tariffId}/items/:itemId/estimate`;

/**
 * Mock the debounced what-if estimate to resolve with a fixed profit + commission.
 * The Plus estimate has NO band — the typed price alone drives it — so the response
 * mirrors {@link EstimatePlusPriceResult} (no `bandKey`). The custom cell only commits
 * when `result.price` echoes the typed price, so the mock always answers "500.00".
 */
function mockEstimate(netProfit: string, commissionPct = '13.10'): void {
  server.use(
    http.post(ESTIMATE_ENDPOINT, () =>
      HttpResponse.json({
        itemId: 'r1',
        price: '500.00',
        commissionPct,
        calculable: true,
        reason: null,
        breakdown: { netProfit, saleMarginPct: '40.00' },
      }),
    ),
  );
}

// The single Plus offer. Its profit is LOW (10) so neither it nor the current price
// (50) can win the "En kârlı" race — the typed custom price, whose live estimate is
// far higher, is the sole winner. The ceiling (777.09) sits above the 500 we type, so
// the MoneyInput accepts the keystrokes.
const offer: PlusBand = {
  key: 'plus',
  price: '777.09',
  commissionPct: '19.00',
  netProfit: '10.00',
  marginPct: '2.00',
};

const row: PlusTariffRow = {
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
  plusIsBetter: false,
  calculable: true,
  reason: null,
  selected: false,
  customPrice: null,
  bands: [offer],
};

// A row where nothing is strictly profitable — current (-30) and the offer (-10) both
// lose — so the "En kârlı" mark must never appear even after a (still-losing) estimate.
const LOSS_ROW: PlusTariffRow = {
  ...row,
  currentNetProfit: '-30.00',
  currentMarginPct: '-4.00',
  bands: [{ ...offer, netProfit: '-10.00', marginPct: '-2.00' }],
};

// A row whose SERVER value is a custom price — proves a deliberate clear (null draft)
// beats even a persisted seed on remount, not just an absent one.
const SEEDED_ROW: PlusTariffRow = { ...row, customPrice: '150.00' };

// A row with a committed custom price (80) BELOW the ceiling (100). The offer band
// carries the CEILING as its price (the adapter's ground truth from `plusPriceUpperLimit`),
// so the custom input's max must be the ceiling — the seller can raise the saved 80 back
// up toward 100, not be trapped at 80.
const CEILING_ROW: PlusTariffRow = {
  ...row,
  customPrice: '80.00',
  bands: [{ ...offer, price: '100.00' }],
};

// Two rows so a join on ROW B can be shown NOT to disturb ROW A's cell state. Row A
// keeps id 'r1' so the shared estimate mock (which echoes itemId 'r1') applies to its
// typed what-if price.
const ROW_A: PlusTariffRow = { ...row, id: 'r1', productTitle: 'Test Ürün 1' };
const ROW_B: PlusTariffRow = { ...row, id: 'r2', productTitle: 'Test Ürün 2' };
const TWO_ROWS: readonly PlusTariffRow[] = [ROW_A, ROW_B];

// Stable references, exactly like the detail-client holds `selection`/`customPrices`
// in useState and its handlers in useCallback. A fresh `{}` or `() => {}` per render
// would land in the `columns` deps and remount every cell on its own — masking whether
// the fix under test (streaming `bestById` through context) actually holds.
const ROWS: readonly PlusTariffRow[] = [row];
const EMPTY_SELECTION: PlusSelectionMap = {};
const EMPTY_CUSTOM_PRICES: PlusCustomPriceMap = {};
const noop = (): void => {};

/**
 * Mirror of the detail-client's ref-based draft store: uncommitted what-if prices live
 * in a `Map` ref (not state) so they survive a cell unmounting without re-rendering the
 * table on every keystroke. Both callbacks are identity-stable, exactly as the real
 * client's `useCallback([])` handlers, so wiring them here keeps `columns` stable.
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

/** The custom-price option card (the nearest `TariffOptionCard` above the price input). */
function customCard(): HTMLElement {
  const input = screen.getByPlaceholderText(/fiyat girin/i);
  const card = input.closest('.isolate');
  if (!(card instanceof HTMLElement)) throw new Error('custom price card not found');
  return card;
}

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
 * Mirror of the detail-client's live-estimate wiring: it holds `customEstimates` in
 * state and feeds them back through `onCustomEstimate` with the same identity guard.
 * Selection + custom prices stay empty (the seller hasn't committed anything — the bug
 * reproduces during LIVE typing, before any commit re-seeds the input).
 */
function TableHarness({ rows = ROWS }: { rows?: readonly PlusTariffRow[] }): React.ReactElement {
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
      <PlusTariffsTable
        rows={rows}
        selection={EMPTY_SELECTION}
        customPrices={EMPTY_CUSTOM_PRICES}
        customEstimates={customEstimates}
        onToggleJoin={noop}
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

/**
 * Full mirror of the detail-client's edit state: `selection` + `customPrices` in ONE
 * `choices` object, its join/deselect handlers identity-stable `useCallback([])` with
 * functional updates, plus the live-estimate feedback. This is what makes the
 * regression meaningful — a join on any row drives real state exactly as production
 * does, so the test proves the table survives it without remounting a sibling's cell.
 * The ceiling join and the custom price are MUTUALLY EXCLUSIVE per row.
 */
function StatefulTableHarness({ rows }: { rows: readonly PlusTariffRow[] }): React.ReactElement {
  const [choices, setChoices] = React.useState<PlusSelectionState>({
    selection: {},
    customPrices: {},
  });
  const [customEstimates, setCustomEstimates] = React.useState<Record<string, string | null>>({});

  const handleToggleJoin = React.useCallback((rowId: string): void => {
    setChoices((prev) => {
      const isCeilingJoined = prev.selection[rowId] === 'plus' && prev.customPrices[rowId] == null;
      return {
        selection: { ...prev.selection, [rowId]: isCeilingJoined ? null : 'plus' },
        customPrices:
          prev.customPrices[rowId] == null
            ? prev.customPrices
            : { ...prev.customPrices, [rowId]: null },
      };
    });
  }, []);
  const handleSelectCustom = React.useCallback((rowId: string, choice: PlusCustomChoice): void => {
    setChoices((prev) => ({
      selection:
        prev.selection[rowId] == null ? prev.selection : { ...prev.selection, [rowId]: null },
      customPrices: { ...prev.customPrices, [rowId]: choice },
    }));
  }, []);
  const handleDeselectCustom = React.useCallback((rowId: string): void => {
    setChoices((prev) => ({
      selection: prev.selection,
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
      <PlusTariffsTable
        rows={rows}
        selection={choices.selection}
        customPrices={choices.customPrices}
        customEstimates={customEstimates}
        onToggleJoin={handleToggleJoin}
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

/**
 * Conditionally mounts the table behind a toggle button — the exact thing DataTable
 * pagination does to off-page rows (and a filter / tab switch does to the whole set):
 * it UNMOUNTS the cell, wiping its local input state. The ref-based draft store lives
 * in this harness (above the toggle), so it outlives the table and re-seeds the input
 * on remount. `customEstimates` also lives here, mirroring the detail-client's ownership.
 */
function DraftPersistenceHarness({ rows }: { rows: readonly PlusTariffRow[] }): React.ReactElement {
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
        <PlusTariffsTable
          rows={rows}
          selection={EMPTY_SELECTION}
          customPrices={EMPTY_CUSTOM_PRICES}
          customEstimates={customEstimates}
          onToggleJoin={noop}
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

describe('PlusTariffsTable — live what-if estimate', () => {
  it('keeps the typed custom price when a live estimate lands (remount regression)', async () => {
    // The winning figure — far above the current price + the offer, so once the live
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

describe("PlusTariffsTable — the 'En kârlı' mark follows the live estimate", () => {
  it('moves the mark to the custom card once the live estimate wins the row', async () => {
    mockEstimate('345.00');
    const { user } = render(<TableHarness />);

    // Before typing: the current baseline (50) beats the Plus offer (10) → the current
    // cell wears the mark, the custom card does not.
    expect(screen.getByText(/en kârlı/i)).toBeInTheDocument();
    expect(within(customCard()).queryByText(/en kârlı/i)).toBeNull();

    // Type a what-if price; its live estimate (345) beats both current and offer.
    await user.type(screen.getByPlaceholderText(/fiyat girin/i), '500');

    // The mark lands in the custom card, driven by the LIVE (still-uncommitted) estimate.
    await waitFor(() => expect(within(customCard()).getByText(/en kârlı/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('never crowns a fully-losing row, even after the live estimate resolves', async () => {
    // current (-30) and offer (-10) both lose; the estimate also returns a loss (-5).
    mockEstimate('-5.00');
    const { user } = render(<TableHarness rows={[LOSS_ROW]} />);

    // Nothing is strictly profitable → no mark anywhere.
    expect(screen.queryByText(/en kârlı/i)).toBeNull();

    await user.type(screen.getByPlaceholderText(/fiyat girin/i), '500');

    // Wait for the estimate to resolve — the custom card's "Plus komisyon %X" hint only
    // appears once the what-if estimate is in.
    await waitFor(
      () => expect(within(customCard()).getByText(/plus komisyon/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );

    // The loss estimate is still not strictly positive, so the row stays unmarked.
    expect(screen.queryByText(/en kârlı/i)).toBeNull();
  });
});

describe('PlusTariffsTable — a join never remounts a sibling row', () => {
  it("keeps ROW A's half-typed custom price when ROW B joins the offer", async () => {
    // ROW A's live estimate wins its row (far above current + offer) so we can wait on
    // the badge landing in its custom card — proof the estimate has resolved.
    mockEstimate('345.00');
    const { user } = render(<StatefulTableHarness rows={TWO_ROWS} />);

    // Type a what-if price into ROW A's custom input (uncommitted draft).
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

    // Join ROW B at the ceiling. This updates `selection` in the harness — the trigger
    // that (with the bug) rebuilt the table columns and remounted EVERY cell, wiping
    // ROW A's still-open input.
    await user.click(
      within(rowByTitle('Test Ürün 2')).getByRole('button', { name: /tavan fiyata katıl/i }),
    );

    // ROW A's draft must survive a join made on ROW B.
    expect(within(rowByTitle('Test Ürün 1')).getByDisplayValue('500')).toBeInTheDocument();
  });

  it("keeps ROW A's COMMITTED custom price and its estimate when ROW B joins the offer", async () => {
    mockEstimate('345.00');
    const { user } = render(<StatefulTableHarness rows={TWO_ROWS} />);

    // Type, wait for the estimate, then COMMIT the custom price.
    const inputA = within(rowByTitle('Test Ürün 1')).getByPlaceholderText(/fiyat girin/i);
    await user.type(inputA, '500');
    await waitFor(
      () =>
        expect(
          within(rowByTitle('Test Ürün 1')).getByRole('button', { name: /bu fiyatla katıl/i }),
        ).toBeEnabled(),
      { timeout: 3000 },
    );
    await user.click(
      within(rowByTitle('Test Ürün 1')).getByRole('button', { name: /bu fiyatla katıl/i }),
    );
    // Committed → the custom foot now reads "Katıldın".
    expect(
      within(rowByTitle('Test Ürün 1')).getByRole('button', { name: /katıldın/i }),
    ).toBeInTheDocument();

    // Join ROW B at the ceiling.
    await user.click(
      within(rowByTitle('Test Ürün 2')).getByRole('button', { name: /tavan fiyata katıl/i }),
    );

    // The committed amount survives, and — because the cell re-rendered rather than
    // remounting — so does its live estimate: the "Plus komisyon %X" hint (derived from
    // `lastResult`) would drop back to the placeholder hint on a remount.
    const rowAAfter = rowByTitle('Test Ürün 1');
    expect(within(rowAAfter).getByDisplayValue('500')).toBeInTheDocument();
    expect(within(customCardIn(rowAAfter)).getByText(/plus komisyon/i)).toBeInTheDocument();
  });
});

describe('PlusTariffsTable — draft survives a pagination unmount', () => {
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

describe('PlusTariffsTable — joining the offer is exclusive with a custom price', () => {
  it('joins the offer at the ceiling when its card is clicked', async () => {
    mockEstimate('345.00');
    const { user } = render(<StatefulTableHarness rows={ROWS} />);

    // The offer starts un-joined ("Tavan fiyata katıl"); clicking its card joins it.
    await user.click(screen.getByRole('button', { name: /tavan fiyata katıl/i }));

    // The offer overlay now reads "Katıldın" and is pressed.
    expect(screen.getByRole('button', { name: /katıldın/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('cancels a committed custom price when the offer card is clicked (XOR)', async () => {
    mockEstimate('345.00');
    const { user } = render(<StatefulTableHarness rows={ROWS} />);

    // Commit a custom price first.
    await user.type(screen.getByPlaceholderText(/fiyat girin/i), '500');
    await waitFor(
      () => expect(screen.getByRole('button', { name: /bu fiyatla katıl/i })).toBeEnabled(),
      { timeout: 3000 },
    );
    await user.click(screen.getByRole('button', { name: /bu fiyatla katıl/i }));
    // Custom is committed → the only "Katıldın" button is its foot.
    expect(screen.getByRole('button', { name: /katıldın/i })).toBeInTheDocument();

    // Now click the Plus offer card. A row has ONE join, so the custom price yields to
    // the ceiling join (mutually exclusive).
    await user.click(screen.getByRole('button', { name: /tavan fiyata katıl/i }));

    // The offer is now the joined option …
    expect(screen.getByRole('button', { name: /katıldın/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // … and the custom price is no longer selected (its commit button is back).
    expect(screen.getByRole('button', { name: /bu fiyatla katıl/i })).toBeInTheDocument();
  });
});

describe('PlusTariffsTable — the custom-price input ceiling is the true ceiling', () => {
  it('lets the seller raise a saved custom price above it, up to the ceiling', async () => {
    mockEstimate('50.00');
    const { user } = render(<TableHarness rows={[CEILING_ROW]} />);

    // The input mounts pre-filled with the committed custom price (80).
    const input = screen.getByPlaceholderText(/fiyat girin/i);
    expect(input).toHaveValue('80');

    // Raise it to 95 — accepted, because the input's max is the CEILING (100), not the
    // committed 80. Before the fix the offer band carried the custom price, capping the
    // max at 80, so this keystroke was refused and the field stuck at '9'.
    await user.clear(input);
    await user.type(input, '95');
    expect(input).toHaveValue('95');
  });
});
