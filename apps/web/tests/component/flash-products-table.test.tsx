import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { FlashProductsTable } from '@/features/campaigns/components/flash-products-table';
import type {
  FlashBand,
  FlashOfferKey,
  FlashProductRow,
} from '@/features/campaigns/lib/adapt-flash-product';
import type {
  FlashCustomChoice,
  FlashCustomPriceMap,
  FlashSelectionMap,
  FlashSelectionState,
} from '@/features/campaigns/lib/flash-bulk-actions';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';

import { render, screen, waitFor, within } from '../helpers/render';
import { HttpResponse, http, server } from '../helpers/msw';

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  // The Flash detail scope carries the LIST id under `tariffId` (the shared scope shape).
  tariffId: '00000000-0000-0000-0000-000000000003',
};

const ESTIMATE_ENDPOINT = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/flash-products/${SCOPE.tariffId}/items/:itemId/estimate`;

/**
 * Mock the debounced what-if estimate to echo the typed price with a fixed profit +
 * commission. The custom cell only commits (and only names a commission band) when
 * `result.price` echoes the typed price, so the mock reflects the request's `price`. A
 * band-sourced estimate names a range; a `current`-sourced one names none.
 */
function mockEstimate(
  netProfit: string,
  opts: { commissionPct?: string; commissionSource?: 'band' | 'current' } = {},
): void {
  const { commissionPct = '13.10', commissionSource = 'band' } = opts;
  server.use(
    http.post(ESTIMATE_ENDPOINT, async ({ request, params }) => {
      const body = (await request.json()) as { price?: string; scenario?: string };
      const price = body.price ?? '500.00';
      return HttpResponse.json({
        itemId: params['itemId'],
        price,
        commissionPct,
        commissionSource,
        calculable: true,
        reason: null,
        breakdown: { netProfit, saleMarginPct: '40.00' },
      });
    }),
  );
}

/** One flash offer rendered as a band-like option. */
function offer(key: FlashOfferKey, overrides: Partial<FlashBand> = {}): FlashBand {
  return {
    key,
    price: '800.00',
    commissionPct: '13.10',
    netProfit: '10.00',
    marginPct: '2.00',
    startsAt: '2026-07-08T00:00:00Z',
    endsAt: '2026-07-08T23:59:00Z',
    validity: 'active',
    ...overrides,
  };
}

// The base row carries BOTH offers priced at 800 (so the custom-price ceiling is 800 and a
// typed 500 is accepted). Their profit is LOW (10) so the current price (50) wins until a
// far-higher custom estimate lands — then the typed custom price is the sole winner.
const row: FlashProductRow = {
  id: 'r1',
  barcode: '123',
  modelCode: 'M1',
  productTitle: 'Test Ürün',
  imageUrl: null,
  category: 'Bayrak',
  brand: 'Marka',
  stock: null,
  currentPrice: '900.00',
  customerPrice: '900.00',
  currentCommissionPct: '19.00',
  currentNetProfit: '50.00',
  currentMarginPct: '6.25',
  calculable: true,
  reason: null,
  hasCommissionTariff: true,
  commissionSource: 'band',
  commissionBands: null,
  selectedOffer: null,
  customPrice: null,
  bands: [offer('h24'), offer('h3')],
};

// The four-band commission ladder the custom-price cell's ⓘ popover lists. Top-down
// (band1 → band4): open above / two windows / open below. The estimate mock echoes the
// typed 500, which lands in band1 ("₺450,00 ve üzeri").
const BANDED_ROW: FlashProductRow = {
  ...row,
  commissionBands: [
    { lowerLimit: '450.00', upperLimit: null, commissionPct: '19.0000' },
    { lowerLimit: '300.00', upperLimit: '449.99', commissionPct: '13.1000' },
    { lowerLimit: '200.00', upperLimit: '299.99', commissionPct: '10.7000' },
    { lowerLimit: null, upperLimit: '199.99', commissionPct: '6.5000' },
  ],
};

// A row where nothing is strictly profitable — current (-30) and every offer (-10) lose —
// so the "En kârlı" mark must never appear even after a (still-losing) estimate.
const LOSS_ROW: FlashProductRow = {
  ...row,
  currentNetProfit: '-30.00',
  currentMarginPct: '-4.00',
  bands: [
    offer('h24', { netProfit: '-10.00', marginPct: '-2.00' }),
    offer('h3', { netProfit: '-10.00', marginPct: '-2.00' }),
  ],
};

// A row whose SERVER value is a custom price — proves a deliberate clear (null draft) beats
// even a persisted seed on remount, not just an absent one.
const SEEDED_ROW: FlashProductRow = { ...row, customPrice: '150.00' };

// A row carrying ONLY the 24 Saatlik offer — its 3 Saatlik cell must render a mute em-dash
// (offer3 absent) that offers nothing to select.
const ONLY_24_ROW: FlashProductRow = {
  ...row,
  id: 'r1',
  productTitle: 'Sadece 24 Saatlik',
  bands: [offer('h24')],
};
// A sibling row that DOES carry a 3 Saatlik offer, so the 3 Saatlik column is rendered for
// the mixed set — making the em-dash on ONLY_24_ROW meaningful.
const BOTH_OFFERS_ROW: FlashProductRow = {
  ...row,
  id: 'r2',
  productTitle: 'İki Teklif',
  bands: [offer('h24', { price: '700.00' }), offer('h3', { price: '650.00' })],
};

// A row whose lowest present offer is 450 (3 Saatlik) — the custom-price ceiling, so the
// input refuses any value above it.
const CEILING_ROW: FlashProductRow = {
  ...row,
  bands: [offer('h24', { price: '600.00' }), offer('h3', { price: '450.00' })],
};

// Two rows so a choice on ROW B can be shown NOT to disturb ROW A's cell state. ROW A keeps
// id 'r1' so the shared estimate mock (which echoes params.itemId) applies to its typed
// what-if price.
const ROW_A: FlashProductRow = { ...row, id: 'r1', productTitle: 'Test Ürün 1' };
const ROW_B: FlashProductRow = { ...row, id: 'r2', productTitle: 'Test Ürün 2' };
const TWO_ROWS: readonly FlashProductRow[] = [ROW_A, ROW_B];

// Stable references, exactly like the detail-client holds `selection`/`customPrices` in
// useState and its handlers in useCallback. A fresh `{}` or `() => {}` per render would land
// in the `columns` deps and remount every cell on its own — masking whether the fix under
// test (streaming volatile state through context) actually holds.
const ROWS: readonly FlashProductRow[] = [row];
const EMPTY_SELECTION: FlashSelectionMap = {};
const EMPTY_CUSTOM_PRICES: FlashCustomPriceMap = {};
const noop = (): void => {};

/**
 * Column visibility is Berkin's rule (computed over the FULL set): a 24h / 3h column shows
 * only when at least one row carries that offer. Compute it from the passed rows, exactly as
 * the detail-client does.
 */
function offerFlags(rows: readonly FlashProductRow[]): {
  showOffer24: boolean;
  showOffer3: boolean;
} {
  return {
    showOffer24: rows.some((r) => r.bands.some((b) => b.key === 'h24')),
    showOffer3: rows.some((r) => r.bands.some((b) => b.key === 'h3')),
  };
}

/**
 * Mirror of the detail-client's ref-based draft store: uncommitted what-if prices live in a
 * `Map` ref (not state) so they survive a cell unmounting without re-rendering the table on
 * every keystroke. Both callbacks are identity-stable, exactly as the real client's
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
 * Mirror of the detail-client's live-estimate wiring: it holds `customEstimates` in state and
 * feeds them back through `onCustomEstimate` with the same identity guard. Selection + custom
 * prices stay empty (the seller hasn't committed anything — the bug reproduces during LIVE
 * typing, before any commit re-seeds the input).
 */
function TableHarness({ rows = ROWS }: { rows?: readonly FlashProductRow[] }): React.ReactElement {
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
  const { showOffer24, showOffer3 } = offerFlags(rows);
  return (
    <TariffScopeProvider scope={SCOPE}>
      <FlashProductsTable
        rows={rows}
        selection={EMPTY_SELECTION}
        customPrices={EMPTY_CUSTOM_PRICES}
        customEstimates={customEstimates}
        showOffer24={showOffer24}
        showOffer3={showOffer3}
        onSelectOffer={noop}
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
 * `choices` object, its select/deselect handlers identity-stable `useCallback([])` with
 * functional updates, plus the live-estimate feedback. This is what makes the regression
 * meaningful — a choice on any row drives real state exactly as production does, so the test
 * proves the table survives it without remounting a sibling's cell. The offer choice and the
 * custom price are MUTUALLY EXCLUSIVE per row.
 */
function StatefulTableHarness({ rows }: { rows: readonly FlashProductRow[] }): React.ReactElement {
  const [choices, setChoices] = React.useState<FlashSelectionState>({
    selection: {},
    customPrices: {},
  });
  const [customEstimates, setCustomEstimates] = React.useState<Record<string, string | null>>({});

  const handleSelectOffer = React.useCallback((rowId: string, key: FlashOfferKey): void => {
    setChoices((prev) => {
      const isSame = prev.selection[rowId] === key && prev.customPrices[rowId] == null;
      return {
        selection: { ...prev.selection, [rowId]: isSame ? null : key },
        customPrices:
          prev.customPrices[rowId] == null
            ? prev.customPrices
            : { ...prev.customPrices, [rowId]: null },
      };
    });
  }, []);
  const handleSelectCustom = React.useCallback((rowId: string, choice: FlashCustomChoice): void => {
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
  const { showOffer24, showOffer3 } = offerFlags(rows);

  return (
    <TariffScopeProvider scope={SCOPE}>
      <FlashProductsTable
        rows={rows}
        selection={choices.selection}
        customPrices={choices.customPrices}
        customEstimates={customEstimates}
        showOffer24={showOffer24}
        showOffer3={showOffer3}
        onSelectOffer={handleSelectOffer}
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
 * pagination does to off-page rows (and a filter / tab switch does to the whole set): it
 * UNMOUNTS the cell, wiping its local input state. The ref-based draft store lives in this
 * harness (above the toggle), so it outlives the table and re-seeds the input on remount.
 */
function DraftPersistenceHarness({
  rows,
}: {
  rows: readonly FlashProductRow[];
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
  const { showOffer24, showOffer3 } = offerFlags(rows);
  return (
    <TariffScopeProvider scope={SCOPE}>
      <button type="button" onClick={() => setMounted((prev) => !prev)}>
        toggle
      </button>
      {mounted ? (
        <FlashProductsTable
          rows={rows}
          selection={EMPTY_SELECTION}
          customPrices={EMPTY_CUSTOM_PRICES}
          customEstimates={customEstimates}
          showOffer24={showOffer24}
          showOffer3={showOffer3}
          onSelectOffer={noop}
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

describe('FlashProductsTable — live what-if estimate', () => {
  it('keeps the typed custom price when a live estimate lands (remount regression)', async () => {
    // The winning figure — far above the current price + every offer, so once the live
    // estimate returns the "En kârlı" marker moves to the custom card.
    mockEstimate('345.00');
    const { user } = render(<TableHarness />);

    // Type a what-if price. Reporting the live estimate back up used to rebuild the TanStack
    // `columns`, which remounted the cell and wiped this very input mid-type.
    const input = screen.getByPlaceholderText(/fiyat girin/i);
    await user.type(input, '500');

    // Wait until the live estimate lands and crowns the custom card the winner.
    await waitFor(() => expect(within(customCard()).getByText(/en kârlı/i)).toBeInTheDocument(), {
      timeout: 3000,
    });

    // The bug's fingerprint: with the remount, this assertion failed because the input reset
    // to empty the instant the estimate returned. It must still hold "500".
    expect(screen.getByDisplayValue('500')).toBeInTheDocument();
  });
});

describe("FlashProductsTable — the 'En kârlı' mark follows the live estimate", () => {
  it('moves the mark to the custom card once the live estimate wins the row', async () => {
    mockEstimate('345.00');
    const { user } = render(<TableHarness />);

    // Before typing: the current baseline (50) beats every offer (10) → the current cell
    // wears the mark, the custom card does not.
    expect(screen.getByText(/en kârlı/i)).toBeInTheDocument();
    expect(within(customCard()).queryByText(/en kârlı/i)).toBeNull();

    // Type a what-if price; its live estimate (345) beats both current and every offer.
    await user.type(screen.getByPlaceholderText(/fiyat girin/i), '500');

    // The mark lands in the custom card, driven by the LIVE (still-uncommitted) estimate.
    await waitFor(() => expect(within(customCard()).getByText(/en kârlı/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    // Exactly one row-winner: the current cell no longer wears the mark.
    expect(screen.getAllByText(/en kârlı/i)).toHaveLength(1);
  });

  it('never crowns a fully-losing row, even after the live estimate resolves', async () => {
    // current (-30) and every offer (-10) lose; the estimate also returns a loss (-5).
    mockEstimate('-5.00');
    const { user } = render(<TableHarness rows={[LOSS_ROW]} />);

    // Nothing is strictly profitable → no mark anywhere.
    expect(screen.queryByText(/en kârlı/i)).toBeNull();

    await user.type(screen.getByPlaceholderText(/fiyat girin/i), '500');

    // Wait for the estimate to resolve — the custom foot "Bu fiyatı seç" only enables once
    // the what-if estimate for the typed price is in (calculable, even at a loss).
    await waitFor(
      () => expect(screen.getByRole('button', { name: /bu fiyatı seç/i })).toBeEnabled(),
      { timeout: 3000 },
    );

    // The loss estimate is still not strictly positive, so the row stays unmarked.
    expect(screen.queryByText(/en kârlı/i)).toBeNull();
  });
});

describe('FlashProductsTable — a choice never remounts a sibling row', () => {
  it("keeps ROW A's half-typed custom price when ROW B selects an offer", async () => {
    // ROW A's live estimate wins its row (far above current + every offer) so we can wait on
    // the badge landing in its custom card — proof the estimate has resolved.
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

    // Select the 24 Saatlik offer on ROW B. This updates `selection` in the harness — the
    // trigger that (with the bug) rebuilt the table columns and remounted EVERY cell, wiping
    // ROW A's still-open input.
    await user.click(
      within(rowByTitle('Test Ürün 2')).getByRole('button', {
        name: /24 saatlik teklifini seç/i,
      }),
    );

    // ROW A's draft must survive a choice made on ROW B.
    expect(within(rowByTitle('Test Ürün 1')).getByDisplayValue('500')).toBeInTheDocument();
  });

  it("keeps ROW A's COMMITTED custom price and its estimate when ROW B selects an offer", async () => {
    mockEstimate('345.00');
    const { user } = render(<StatefulTableHarness rows={TWO_ROWS} />);

    // Type, wait for the estimate, then COMMIT the custom price.
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

    // Select the 24 Saatlik offer on ROW B.
    await user.click(
      within(rowByTitle('Test Ürün 2')).getByRole('button', {
        name: /24 saatlik teklifini seç/i,
      }),
    );

    // The committed amount survives, and — because the cell re-rendered rather than
    // remounting — so does its live estimate: the commission hint (derived from `lastResult`)
    // stays on screen. A remount would drop `lastResult` back to null, reverting the hint to
    // the CEILING placeholder ("Maks. ₺800,00 girebilirsin"). Flash rows always carry a
    // ceiling, so the placeholder is that hint (never "Bir fiyat girin") — its ABSENCE is the
    // fingerprint that `lastResult` survived.
    const rowAAfter = rowByTitle('Test Ürün 1');
    const customA = within(customCardIn(rowAAfter));
    expect(within(rowAAfter).getByDisplayValue('500')).toBeInTheDocument();
    // The estimate's commission line is still shown …
    expect(customA.getByText(/%13,10/)).toBeInTheDocument();
    // … and the ceiling placeholder has NOT come back (which it would on a remount).
    expect(customA.queryByText(/girebilirsin/i)).toBeNull();
  });
});

describe('FlashProductsTable — draft survives a pagination unmount', () => {
  it('restores a still-typed, uncommitted custom price after an unmount/remount', async () => {
    mockEstimate('345.00');
    const { user } = render(<DraftPersistenceHarness rows={ROWS} />);

    // Type an uncommitted what-if price (no committed/server value backs it — the exact case
    // the bug lost, since only a committed price used to re-seed).
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

describe('FlashProductsTable — offer / custom are mutually exclusive (XOR)', () => {
  it('joins an offer when its card is clicked', async () => {
    mockEstimate('345.00');
    const { user } = render(<StatefulTableHarness rows={ROWS} />);

    // The 24 Saatlik offer starts un-joined; clicking its card chooses it.
    await user.click(screen.getByRole('button', { name: /24 saatlik teklifini seç/i }));

    // The chosen offer's overlay now reads "Seçildi" and is pressed.
    expect(screen.getByRole('button', { name: /seçildi/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('switches from 24 Saatlik to 3 Saatlik, keeping only one selected', async () => {
    mockEstimate('345.00');
    const { user } = render(<StatefulTableHarness rows={ROWS} />);

    await user.click(screen.getByRole('button', { name: /24 saatlik teklifini seç/i }));
    // 24 Saatlik is joined; 3 Saatlik is still selectable.
    expect(screen.getByRole('button', { name: /3 saatlik teklifini seç/i })).toBeInTheDocument();

    // Choose 3 Saatlik → it takes the row, 24 Saatlik yields (only one selected at a time).
    await user.click(screen.getByRole('button', { name: /3 saatlik teklifini seç/i }));
    expect(screen.getByRole('button', { name: /seçildi/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // 24 Saatlik is back to its selectable label — no longer joined.
    expect(screen.getByRole('button', { name: /24 saatlik teklifini seç/i })).toBeInTheDocument();
  });

  it('cancels a committed custom price when an offer card is clicked (XOR)', async () => {
    mockEstimate('345.00');
    const { user } = render(<StatefulTableHarness rows={ROWS} />);

    // Commit a custom price first.
    await user.type(screen.getByPlaceholderText(/fiyat girin/i), '500');
    await waitFor(
      () => expect(screen.getByRole('button', { name: /bu fiyatı seç/i })).toBeEnabled(),
      { timeout: 3000 },
    );
    await user.click(screen.getByRole('button', { name: /bu fiyatı seç/i }));
    // Custom is committed → the only "Seçildi" button is its foot.
    expect(screen.getByRole('button', { name: /seçildi/i })).toBeInTheDocument();

    // Now click an offer card. A row has ONE join, so the custom price yields to the offer.
    await user.click(screen.getByRole('button', { name: /24 saatlik teklifini seç/i }));

    // The offer is now the joined option …
    expect(screen.getByRole('button', { name: /seçildi/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // … and the custom price is no longer selected (its commit button is back).
    expect(screen.getByRole('button', { name: /bu fiyatı seç/i })).toBeInTheDocument();
  });
});

describe('FlashProductsTable — offer column visibility (flash-specific)', () => {
  it('renders NO "3 Saatlik" column when no row in the set carries a 3 Saatlik offer', () => {
    mockEstimate('345.00');
    render(<TableHarness rows={[ONLY_24_ROW]} />);

    // The 24 Saatlik column is present; the 3 Saatlik column is not rendered at all.
    expect(screen.getByRole('columnheader', { name: '24 Saatlik' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '3 Saatlik' })).toBeNull();
  });

  it('renders both columns for a mixed set and shows an unselectable em-dash where an offer is absent', () => {
    mockEstimate('345.00');
    render(<TableHarness rows={[ONLY_24_ROW, BOTH_OFFERS_ROW]} />);

    // Mixed set → both offer columns exist.
    expect(screen.getByRole('columnheader', { name: '24 Saatlik' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '3 Saatlik' })).toBeInTheDocument();

    // Column order: product(0), current(1), 24 Saatlik(2), 3 Saatlik(3), custom(4). The
    // 24-only row's 3 Saatlik cell renders a mute em-dash and offers nothing to select.
    const cells = within(rowByTitle('Sadece 24 Saatlik')).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('—');
    expect(within(cells[3]).queryByRole('button')).toBeNull();

    // Its 24 Saatlik cell IS a selectable card.
    expect(
      within(cells[2]).getByRole('button', { name: /24 saatlik teklifini seç/i }),
    ).toBeInTheDocument();

    // Only the rows that carry a 3 Saatlik offer add a "3 Saatlik teklifini seç" target —
    // exactly one here (the sibling row), never the absent-offer cell.
    expect(screen.getAllByRole('button', { name: /3 saatlik teklifini seç/i })).toHaveLength(1);
  });
});

describe('FlashProductsTable — custom price is capped at the lowest offer', () => {
  it('names the ceiling in the placeholder hint and refuses a value above it', async () => {
    mockEstimate('345.00');
    const { user } = render(<TableHarness rows={[CEILING_ROW]} />);

    // The lowest present offer is 450 → the placeholder names it as the cap.
    expect(screen.getByText(/maks\. ₺450,00 girebilirsin/i)).toBeInTheDocument();

    // Typing up to the ceiling is accepted; a further digit that would push over 450 is
    // refused — the field stops at the last valid value, never showing "4509".
    const input = screen.getByPlaceholderText(/fiyat girin/i);
    await user.type(input, '4509');
    expect(input).toHaveValue('450');
    expect(screen.queryByDisplayValue('4509')).toBeNull();
  });
});

describe('FlashProductsTable — commission-band hint on the custom-price cell', () => {
  it('labels the commission band the typed price lands in once a band-sourced estimate returns', async () => {
    mockEstimate('345.00', { commissionPct: '19.00', commissionSource: 'band' });
    const { user } = render(<TableHarness rows={[BANDED_ROW]} />);

    // Before typing: no range label, just the placeholder hint.
    expect(screen.queryByText(/ve üzeri/i)).toBeNull();

    // Type a what-if price; its band (500 → band1 "₺450,00 ve üzeri") is named once the
    // estimate lands. The band the price falls in is found CLIENT-side (comparison only).
    await user.type(screen.getByPlaceholderText(/fiyat girin/i), '500');
    await waitFor(() => expect(screen.getByText(/₺450,00 ve üzeri/)).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('opens a popover listing every commission band with its rate (flash namespace)', async () => {
    mockEstimate('345.00', { commissionPct: '19.00', commissionSource: 'band' });
    const { user } = render(<TableHarness rows={[BANDED_ROW]} />);

    // The ⓘ rides at the END of the derived range line, so it only appears once a typed price
    // has a band-sourced estimate. Type a price and wait for the range line to land.
    await user.type(screen.getByPlaceholderText(/fiyat girin/i), '500');
    await waitFor(() => expect(screen.getByText(/₺450,00 ve üzeri/)).toBeInTheDocument(), {
      timeout: 3000,
    });

    await user.click(screen.getByRole('button', { name: /komisyon bantlarını göster/i }));

    // The popover lists the four bands top-down, each with its window + commission. Scope the
    // assertions to the popover: band1's window ("₺450,00 ve üzeri") also shows in the derived
    // range line, so a page-wide getByText would match it twice.
    const popover = within(screen.getByRole('dialog'));
    expect(popover.getByText('Ürün komisyon teklifleri')).toBeInTheDocument();
    expect(popover.getByText('₺450,00 ve üzeri')).toBeInTheDocument();
    expect(popover.getByText('₺300,00–₺449,99')).toBeInTheDocument();
    expect(popover.getByText('₺199,99 ve altı')).toBeInTheDocument();
    // The lowest band's commission renders in the Turkish percent convention.
    expect(popover.getByText('%6,50')).toBeInTheDocument();
  });

  it('shows no range label or ⓘ when the estimate is flat-rate sourced (commissionSource = current)', async () => {
    // Even though this row HAS a commission-band ladder, a `current`-sourced estimate means
    // the flat "Mevcut Komisyon" rate applied — there is no band to point at, so no range
    // label and no ⓘ.
    mockEstimate('345.00', { commissionPct: '19.00', commissionSource: 'current' });
    const { user } = render(<TableHarness rows={[BANDED_ROW]} />);

    await user.type(screen.getByPlaceholderText(/fiyat girin/i), '500');
    // Wait for the estimate to resolve (the commit foot enables).
    await waitFor(
      () => expect(screen.getByRole('button', { name: /bu fiyatı seç/i })).toBeEnabled(),
      { timeout: 3000 },
    );

    expect(screen.queryByText(/ve üzeri/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /komisyon bantlarını göster/i })).toBeNull();
  });

  it('renders no commission-band hint for a flat-rate row (no ladder)', () => {
    mockEstimate('345.00');
    // The base `row` has commissionBands === null (flat rate) — no ladder to show.
    render(<TableHarness rows={[row]} />);
    expect(screen.queryByRole('button', { name: /komisyon bantlarını göster/i })).toBeNull();
  });
});
