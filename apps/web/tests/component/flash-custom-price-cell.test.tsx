import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FlashCustomPriceCell } from '@/features/campaigns/components/flash-custom-price-cell';
import type {
  FlashBand,
  FlashOfferKey,
  FlashProductRow,
} from '@/features/campaigns/lib/adapt-flash-product';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';

import { render, screen } from '../helpers/render';
import { HttpResponse, http, server } from '../helpers/msw';

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  // The Flash detail scope carries the LIST id under `tariffId` (the shared scope shape).
  tariffId: '00000000-0000-0000-0000-000000000003',
};

const ESTIMATE_ENDPOINT = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/flash-products/${SCOPE.tariffId}/items/:itemId/estimate`;

/** Mock the debounced what-if estimate to echo the typed price with a fixed profit. */
function mockEstimate(netProfit: string): void {
  server.use(
    http.post(ESTIMATE_ENDPOINT, async ({ request, params }) => {
      const body = (await request.json()) as { price?: string };
      return HttpResponse.json({
        itemId: params['itemId'],
        price: body.price ?? '500.00',
        commissionPct: '13.10',
        commissionSource: 'band',
        calculable: true,
        reason: null,
        breakdown: { netProfit, saleMarginPct: '40.00' },
      });
    }),
  );
}

/** One flash offer priced at 800 — so the custom-price ceiling is 800 and a seeded 500 is accepted. */
function offer(key: FlashOfferKey): FlashBand {
  return {
    key,
    price: '800.00',
    commissionPct: '13.10',
    netProfit: '10.00',
    marginPct: '2.00',
    startsAt: '2026-07-08T00:00:00Z',
    endsAt: '2026-07-08T23:59:00Z',
    validity: 'active',
  };
}

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
  flashDay: '2026-07-08T00:00:00Z',
};

function renderCell(props: React.ComponentProps<typeof FlashCustomPriceCell>) {
  return render(
    <TariffScopeProvider scope={SCOPE}>
      <FlashCustomPriceCell {...props} />
    </TariffScopeProvider>,
  );
}

describe('FlashCustomPriceCell — estimate skeleton', () => {
  it('shows a skeleton in the badge slot while a seeded committed price is being estimated, then the real badge', async () => {
    mockEstimate('180.00');
    renderCell({
      // Flash seeds NO committed profit on reload, so the badge must wait on the estimate.
      row: { ...row, customPrice: '500.00' },
      committedPrice: '500.00',
      committedNetProfit: null,
      committedMarginPct: null,
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
    server.use(
      http.post(ESTIMATE_ENDPOINT, () =>
        HttpResponse.json({
          itemId: 'r1',
          price: '500.00',
          commissionPct: null,
          commissionSource: 'current',
          calculable: false,
          reason: 'NO_COST',
          breakdown: null,
        }),
      ),
    );
    renderCell({
      row: { ...row, customPrice: '500.00', calculable: false, reason: 'NO_COST' },
      committedPrice: '500.00',
      isSelected: true,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
    });
    // A resolved (known) not-calculable result clears the skeleton and shows the short reason.
    expect(await screen.findByText(/maliyet girin/i)).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('drops the skeleton to the default "—" badge when the estimate errors', async () => {
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
      committedPrice: '500.00',
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

  it('shows a seeded committed profit as a real badge (no skeleton) when one is provided', async () => {
    // The Plus / commission verticals seed the committed profit on reload — the cell shows it
    // immediately (no loading pill), then the live estimate refines it.
    mockEstimate('180.00');
    renderCell({
      row: { ...row, customPrice: '500.00' },
      committedPrice: '500.00',
      committedNetProfit: '175.00',
      committedMarginPct: '35.00',
      isSelected: true,
      onSelect: vi.fn(),
      onDeselect: vi.fn(),
    });
    // No skeleton — the seeded figure fills the badge slot right away.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: /kâr detayını gör/i })).toBeInTheDocument();
  });

  it('hides the calculated-profit block entirely on an empty card (no skeleton)', () => {
    renderCell({ row, isSelected: false, onSelect: vi.fn(), onDeselect: vi.fn() });
    expect(screen.queryByText(/hesaplanan kâr/i)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
