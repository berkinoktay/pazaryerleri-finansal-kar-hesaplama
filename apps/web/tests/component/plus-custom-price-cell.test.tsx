import { createTranslator } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PlusCustomPriceCell } from '@/features/campaigns/components/plus-custom-price-cell';
import type { PlusBand, PlusTariffRow } from '@/features/campaigns/lib/adapt-plus-tariff';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';

import { render, screen, waitFor } from '../helpers/render';
import { HttpResponse, http, server } from '../helpers/msw';
import trMessages from '../../messages/tr.json';

// Every expected string is built from the catalog, never typed.
const tTable = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'plusCommissionTariffsPage.table',
});

const ENTER_PRICE = tTable('enterPrice');
const JOIN_CUSTOM = tTable('selectCustom');
const HINT = tTable('customPriceHint');
const HINT_NO_CEILING = tTable('customPriceHintNoCeiling');

// Longer than the ~400ms debounce: a positive price would have estimated by now.
const PAST_DEBOUNCE_MS = 700;

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  tariffId: '00000000-0000-0000-0000-000000000003',
};

const ESTIMATE_URL = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/plus-commission-tariffs/${SCOPE.tariffId}/items/:itemId/estimate`;

/** Minimal breakdown: the cell reads only `netProfit` and `saleMarginPct`. */
const BREAKDOWN = { netProfit: '34.00', saleMarginPct: '7.56' };

/** The `price` of an estimate request body, or null when the body has none. */
function priceOf(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'price' in body) {
    return typeof body.price === 'string' ? body.price : null;
  }
  return null;
}

/**
 * Mock the debounced what-if estimate. By default it answers for the requested price, so
 * the foot can enable for exactly the typed amount; `answerPrice` overrides the echoed
 * price. Every request body is handed to `onRequest`.
 */
function mockEstimate(
  options: { answerPrice?: string; onRequest?: (body: unknown) => void } = {},
): void {
  server.use(
    http.post(ESTIMATE_URL, async ({ request }) => {
      const body: unknown = await request.json();
      options.onRequest?.(body);
      return HttpResponse.json({
        itemId: 'r1',
        price: options.answerPrice ?? priceOf(body),
        commissionPct: '13.1',
        calculable: true,
        reason: null,
        breakdown: BREAKDOWN,
      });
    }),
  );
}

// The Plus offer at a known ceiling.
const offer: PlusBand = {
  key: 'plus',
  price: '777.09',
  commissionPct: '13.1',
  netProfit: '70.79',
  marginPct: '9.11',
};

const row: PlusTariffRow = {
  id: 'r1',
  barcode: '123',
  stockCode: 'M1',
  productTitle: 'Test Product',
  imageUrl: null,
  category: 'Flag',
  brand: 'Brand',
  currentPrice: '800.00',
  commissionBasePrice: '780.00',
  currentCommissionPct: '19',
  currentNetProfit: '50.00',
  currentMarginPct: '6.25',
  plusIsBetter: true,
  calculable: true,
  reason: null,
  selected: false,
  customPrice: null,
  bands: [offer],
};

// The file's Plus price upper limit could not be read: the offer has no price and no
// profit, so the custom price is the only way to join.
const noPriceOffer: PlusBand = { ...offer, price: null, netProfit: null, marginPct: null };
const unknownRow: PlusTariffRow = { ...row, plusIsBetter: false, bands: [noPriceOffer] };

function renderCell(props: React.ComponentProps<typeof PlusCustomPriceCell>) {
  return render(
    <TariffScopeProvider scope={SCOPE}>
      <PlusCustomPriceCell {...props} />
    </TariffScopeProvider>,
  );
}

describe('PlusCustomPriceCell', () => {
  it('sends no estimate for a typed price that rounds to 0.00', async () => {
    let estimateCalls = 0;
    mockEstimate({
      onRequest: () => {
        estimateCalls += 1;
      },
    });
    const onEstimate = vi.fn();
    const { user } = renderCell({
      row,
      isSelected: false,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
      onEstimate,
    });

    // 0,004 is above 0 but is sent as 0.00, which the selection route refuses.
    await user.type(screen.getByPlaceholderText(ENTER_PRICE), '0,004');
    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));

    expect(estimateCalls).toBe(0);
    expect(onEstimate).not.toHaveBeenCalledWith('r1', expect.anything());
  });

  it('keeps the join button disabled for a price that rounds to 0.00', async () => {
    // An estimate that answers for 0.00 is the worst case: once the typed price also reads
    // 0.00 at two decimals, only the positive-at-cents guard keeps the foot disabled.
    mockEstimate({ answerPrice: '0.00' });
    const onEstimate = vi.fn();
    const onSelect = vi.fn();
    const { user } = renderCell({
      row,
      isSelected: false,
      onSelect,
      onDeselect: vi.fn(),
      onEstimate,
    });
    const input = screen.getByPlaceholderText(ENTER_PRICE);

    await user.type(input, '5');
    await waitFor(() => expect(onEstimate).toHaveBeenCalledWith('r1', BREAKDOWN.netProfit));
    await user.clear(input);
    await user.type(input, '0,004');

    const join = screen.getByRole('button', { name: JOIN_CUSTOM });
    expect(join).toBeDisabled();
    await user.click(join);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('accepts a price with no maximum and shows the no-ceiling hint when the ceiling is unknown', async () => {
    mockEstimate();
    const { user } = renderCell({
      row: unknownRow,
      isSelected: false,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
    });

    // Before a price is in, the hint asks for the price plainly: there is no ceiling to
    // stay under.
    expect(screen.getByText(HINT_NO_CEILING)).toBeInTheDocument();
    expect(screen.queryByText(HINT)).toBeNull();

    const input = screen.getByPlaceholderText(ENTER_PRICE);
    await user.type(input, '5000');
    // Far above any ceiling the known-price fixture carries, and no keystroke was refused.
    expect(input).toHaveValue('5000');
  });

  it('estimates and joins a custom price when the ceiling is unknown', async () => {
    const bodies: unknown[] = [];
    mockEstimate({ onRequest: (body) => bodies.push(body) });
    const onSelect = vi.fn();
    const { user } = renderCell({
      row: unknownRow,
      isSelected: false,
      onSelect,
      onDeselect: vi.fn(),
    });

    await user.type(screen.getByPlaceholderText(ENTER_PRICE), '900');
    const join = screen.getByRole('button', { name: JOIN_CUSTOM });
    await waitFor(() => expect(join).toBeEnabled());
    expect(bodies).toContainEqual({ price: '900.00' });

    await user.click(join);
    expect(onSelect).toHaveBeenCalledWith({
      price: '900.00',
      netProfit: BREAKDOWN.netProfit,
      marginPct: BREAKDOWN.saleMarginPct,
    });
  });

  it('caps the input at the ceiling when it is known', async () => {
    mockEstimate();
    const { user } = renderCell({ row, isSelected: false, onSelect: vi.fn(), onDeselect: vi.fn() });

    // A known ceiling keeps the usual hint.
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(screen.queryByText(HINT_NO_CEILING)).toBeNull();

    const input = screen.getByPlaceholderText(ENTER_PRICE);
    await user.type(input, '5000');
    // 500 is under the 777.09 ceiling; the fourth digit would push it over and is refused.
    expect(input).toHaveValue('500');
  });

  describe('unknown Plus commission', () => {
    // The file's Plus commission offer could not be read: the backend refuses the
    // estimate and every join on the row, also with a custom price.
    const noCommissionOffer: PlusBand = {
      ...offer,
      commissionPct: null,
      netProfit: null,
      marginPct: null,
    };
    const noCommissionRow: PlusTariffRow = {
      ...row,
      plusIsBetter: false,
      bands: [noCommissionOffer],
    };
    const UNKNOWN_COMMISSION_HINT = tTable('plusCommissionUnknownHint');
    const CUSTOM_SELECTED = tTable('customSelected');

    it('keeps the select foot disabled and sends no estimate when the Plus commission is unknown', async () => {
      let estimateCalls = 0;
      mockEstimate({
        onRequest: () => {
          estimateCalls += 1;
        },
      });
      const onEstimate = vi.fn();
      const onSelect = vi.fn();
      // A stored (not joined) custom price puts a positive price in the input, so only the
      // unknown commission keeps the debounced estimate out.
      const { user } = renderCell({
        row: { ...noCommissionRow, customPrice: '500.00' },
        isSelected: false,
        onSelect,
        onDeselect: vi.fn(),
        onEstimate,
      });

      const input = screen.getByPlaceholderText(ENTER_PRICE);
      expect(input).toHaveValue('500');
      expect(input).toBeDisabled();
      // The hint line says why, in place of the usual ceiling hint.
      expect(screen.getByText(UNKNOWN_COMMISSION_HINT)).toBeInTheDocument();
      expect(screen.queryByText(HINT)).toBeNull();

      await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
      expect(estimateCalls).toBe(0);
      expect(onEstimate).not.toHaveBeenCalledWith('r1', expect.anything());

      const join = screen.getByRole('button', { name: JOIN_CUSTOM });
      expect(join).toBeDisabled();
      await user.click(join);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('can still remove a committed custom price', async () => {
      let estimateCalls = 0;
      mockEstimate({
        onRequest: () => {
          estimateCalls += 1;
        },
      });
      const onDeselect = vi.fn();
      const { user } = renderCell({
        row: { ...noCommissionRow, selected: true, customPrice: '500.00' },
        isSelected: true,
        onSelect: vi.fn(),
        onDeselect,
        committedPrice: '500.00',
      });

      const foot = screen.getByRole('button', { name: CUSTOM_SELECTED });
      expect(foot).toBeEnabled();
      expect(foot).toHaveAttribute('aria-pressed', 'true');
      await user.click(foot);
      expect(onDeselect).toHaveBeenCalledTimes(1);
      // Past the debounce, so a guard that let the committed price estimate would show.
      await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
      expect(estimateCalls).toBe(0);
    });
  });
});
