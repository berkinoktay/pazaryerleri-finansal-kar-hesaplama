import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CustomPriceCell } from '@/features/campaigns/components/custom-price-cell';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';
import type { CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

import { render, screen, waitFor } from '../helpers/render';
import { HttpResponse, http, server } from '../helpers/msw';

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  tariffId: '00000000-0000-0000-0000-000000000003',
};

const ESTIMATE_ENDPOINT = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/commission-tariffs/${SCOPE.tariffId}/items/:itemId/estimate`;

/** Minimal breakdown — only `netProfit` is read by the onEstimate report. */
const BREAKDOWN = { netProfit: '34.00', saleMarginPct: '7.56' };

/** Mock the debounced what-if estimate to resolve with a fixed profit. */
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
        breakdown: { ...BREAKDOWN, netProfit },
      }),
    ),
  );
}

const band: PriceBand = {
  key: 'band2',
  lowerLimit: '400.00',
  upperLimit: '777.09',
  price: '777.09',
  commissionPct: '13.1',
  netProfit: '70.79',
  marginPct: '9.11',
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
  bands: [band, band, band, band],
};

function renderCell(props: React.ComponentProps<typeof CustomPriceCell>) {
  return render(
    <TariffScopeProvider scope={SCOPE}>
      <CustomPriceCell {...props} />
    </TariffScopeProvider>,
  );
}

describe('CustomPriceCell', () => {
  it('hides the calculated-profit block when empty, showing only input + hint + a disabled select', () => {
    renderCell({ row, isSelected: false, onSelect: vi.fn(), onDeselect: vi.fn() });
    expect(screen.getByPlaceholderText(/fiyat girin/i)).toBeInTheDocument();
    // Before a price is typed, the derived line shows the "type a price" hint.
    expect(screen.getByText(/fiyat girince tahmini kâr/i)).toBeInTheDocument();
    // The "Hesaplanan kâr" block does not render at all on an empty card — no mute "—" chip.
    expect(screen.queryByText(/hesaplanan kâr/i)).toBeNull();
    // The select is disabled until a calculable estimate for a typed price is in.
    expect(screen.getByRole('button', { name: /bu fiyatı seç/i })).toBeDisabled();
  });

  it('shows a skeleton in the badge slot while a seeded price is being estimated, then the real badge', async () => {
    mockEstimate('34.00');
    renderCell({
      // A committed price seeds the input on reload; with no committed profit to seed the
      // figure, the badge must WAIT on the estimate rather than flash a mute "—".
      row: { ...row, customPrice: '500.00' },
      isSelected: true,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
    });
    // The "Hesaplanan kâr" label stays, but its badge slot is a loading pill (role=status),
    // never a mute "—" and never the profit badge yet.
    expect(screen.getByText(/hesaplanan kâr/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.queryByRole('button', { name: /kâr detayını gör/i })).toBeNull();
    // Once the debounced estimate lands, the real badge replaces the skeleton.
    expect(await screen.findByRole('button', { name: /kâr detayını gör/i })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the reason chip — never a skeleton — when the estimate is not calculable', async () => {
    // A not-calculable estimate is a resolved (known) result, so the skeleton must clear and
    // the badge carry the short reason chip instead.
    server.use(
      http.post(ESTIMATE_ENDPOINT, () =>
        HttpResponse.json({
          itemId: 'r1',
          price: '500.00',
          bandKey: null,
          commissionPct: null,
          calculable: false,
          reason: 'NO_COST',
          breakdown: null,
        }),
      ),
    );
    renderCell({
      row: { ...row, customPrice: '500.00', calculable: false, reason: 'NO_COST' },
      isSelected: true,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
    });
    expect(await screen.findByText(/maliyet girin/i)).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('drops the skeleton to the default "—" badge when the estimate errors', async () => {
    // A failed estimate must not leave the pill spinning forever — it falls back to the
    // neutral "—" badge (the global toast surfaces the error separately).
    server.use(
      http.post(ESTIMATE_ENDPOINT, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Server Error', status: 500, code: 'INTERNAL_ERROR' },
          { status: 500 },
        ),
      ),
    );
    renderCell({
      row: { ...row, customPrice: '500.00' },
      isSelected: true,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
    });
    // Starts as a skeleton (seeded price, no result yet)...
    expect(screen.getByRole('status')).toBeInTheDocument();
    // ...then the error resolves it to the default "—" badge, skeleton gone.
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reveals the calculated-profit block once a price is typed', async () => {
    mockEstimate('34.00');
    const { user } = renderCell({ row, isSelected: false, onSelect: vi.fn(), onDeselect: vi.fn() });
    // Empty card: no calculated-profit block.
    expect(screen.queryByText(/hesaplanan kâr/i)).toBeNull();
    await user.type(screen.getByPlaceholderText(/fiyat girin/i), '500');
    // A price in the input reveals the block (its estimate then fills the badge).
    expect(await screen.findByText(/hesaplanan kâr/i)).toBeInTheDocument();
  });

  it('seeds the input from a persisted custom price', () => {
    renderCell({
      row: { ...row, customPrice: '1250.00' },
      isSelected: true,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
    });
    // tr-TR display string with no grouping while editing (formatTrMoney).
    expect(screen.getByDisplayValue('1250')).toBeInTheDocument();
  });

  it('shows the selected label + pressed state for the active custom choice', () => {
    renderCell({ row, isSelected: true, onSelect: vi.fn(), onDeselect: vi.fn() });
    expect(screen.getByRole('button', { name: /seçildi/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('un-commits when the select control is clicked while selected', async () => {
    const onDeselect = vi.fn();
    const { user } = renderCell({ row, isSelected: true, onSelect: vi.fn(), onDeselect });
    await user.click(screen.getByRole('button', { name: /seçildi/i }));
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it('shows the "En kârlı" ribbon when isBest is set, and not otherwise', () => {
    const { rerender } = renderCell({
      row,
      isBest: false,
      isSelected: false,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
    });
    expect(screen.queryByText(/en kârlı/i)).toBeNull();
    rerender(
      <TariffScopeProvider scope={SCOPE}>
        <CustomPriceCell
          row={row}
          isBest
          isSelected={false}
          onSelect={vi.fn()}
          onDeselect={vi.fn()}
        />
      </TariffScopeProvider>,
    );
    expect(screen.getByText(/en kârlı/i)).toBeInTheDocument();
  });

  it('reports the live estimated profit via onEstimate after typing a price', async () => {
    mockEstimate('34.00');
    const onEstimate = vi.fn();
    const { user } = renderCell({
      row,
      isSelected: false,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
      onEstimate,
    });
    // Typing debounces (~400ms) then estimates; onSuccess reports the shown profit so
    // the row's "En kârlı" race can move to the custom card before any commit.
    await user.type(screen.getByPlaceholderText(/fiyat girin/i), '500');
    // The cell reports its own rowId alongside the figure so the parent's one stable
    // handler can be passed directly (no per-row inline arrow).
    await waitFor(() => expect(onEstimate).toHaveBeenCalledWith('r1', '34.00'));
  });

  it('reports null via onEstimate when the input is cleared', async () => {
    mockEstimate('34.00');
    const onEstimate = vi.fn();
    const { user } = renderCell({
      row,
      isSelected: false,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
      onEstimate,
    });
    const input = screen.getByPlaceholderText(/fiyat girin/i);
    await user.type(input, '500');
    await user.clear(input);
    // Clearing drops the custom candidate immediately — the badge race must stop
    // treating this row's custom price as a contender.
    expect(onEstimate).toHaveBeenCalledWith('r1', null);
  });

  it('seeds the input from a surviving draft over the committed/server price', () => {
    // A draft survives a pagination unmount in the parent's ref store, so on remount it
    // takes priority — even when there is no committed or persisted custom price.
    renderCell({
      row,
      isSelected: false,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
      getDraft: () => '250.00',
    });
    expect(screen.getByDisplayValue('250')).toBeInTheDocument();
  });

  it('starts empty when the draft is a deliberate clear (null), ignoring the committed price', () => {
    // A `null` draft means the seller cleared the field; the remount must stay empty
    // rather than fall back to the committed custom price.
    renderCell({
      row,
      isSelected: true,
      committedPrice: '150.00',
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
      getDraft: () => null,
    });
    expect(screen.getByPlaceholderText(/fiyat girin/i)).toHaveValue('');
  });

  it('persists the draft via onDraftChange while typing and clearing', async () => {
    mockEstimate('34.00');
    const onDraftChange = vi.fn();
    const { user } = renderCell({
      row,
      isSelected: false,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
      onDraftChange,
    });
    const input = screen.getByPlaceholderText(/fiyat girin/i);
    await user.type(input, '500');
    // Every keystroke records the draft (as a 2-decimal string) so a later unmount
    // doesn't lose it; the last value typed is the full amount.
    expect(onDraftChange).toHaveBeenLastCalledWith('r1', '500.00');
    await user.clear(input);
    // A deliberate clear records `null` so the remounted input stays empty.
    expect(onDraftChange).toHaveBeenLastCalledWith('r1', null);
  });
});
