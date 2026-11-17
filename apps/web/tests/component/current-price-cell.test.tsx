import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { CurrentPriceCell } from '@/features/campaigns/components/current-price-cell';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';
import type { CommissionTariffRow } from '@/features/campaigns/types';

import { render, screen, waitFor, within } from '../helpers/render';
import { HttpResponse, http, server } from '../helpers/msw';
import trMessages from '../../messages/tr.json';

const OPEN_LABEL = trMessages.profitBadge.open;
const INFO_HINT_LABEL = trMessages.common.infoHint;
const PRICE_UNKNOWN = trMessages.commissionTariffsPage.table.priceUnknown;
const PRICE_UNKNOWN_HINT = trMessages.commissionTariffsPage.table.priceUnknownHint;
const NOT_CALCULABLE = trMessages.profitBreakdown.notCalculable;

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  tariffId: '00000000-0000-0000-0000-000000000003',
};

const ESTIMATE_URL = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/commission-tariffs/${SCOPE.tariffId}/items/:itemId/estimate`;

// A calculable row whose commission-base price (the price the buyer sees) differs
// from its raw sale price, so the "which price is the hero" behaviour is testable.
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
  bands: [],
};

function renderCell(props: React.ComponentProps<typeof CurrentPriceCell>) {
  return render(
    <TariffScopeProvider scope={SCOPE}>
      <CurrentPriceCell {...props} />
    </TariffScopeProvider>,
  );
}

describe('CurrentPriceCell', () => {
  it('shows the customer-facing price + commission + profit badge, without row-label text', () => {
    renderCell({ row });
    // Hero = the price the buyer sees (commission-base), NOT the raw sale price.
    expect(screen.getByText(/780,00/)).toBeInTheDocument();
    // Current commission, tr-TR percent formatting of the "19" percent string.
    expect(screen.getByText(/%19/)).toBeInTheDocument();
    // Profit amount via the shared, clickable ProfitBadge.
    expect(screen.getByRole('button', { name: OPEN_LABEL })).toHaveTextContent(/50,00/);
    // The rejected two-row layout's labels must be gone — only the price shows.
    expect(screen.queryByText('Satış fiyatı')).toBeNull();
    expect(screen.queryByText('Müşterinin gördüğü fiyat')).toBeNull();
  });

  it('falls back to the sale price when the commission-base price is absent', () => {
    renderCell({ row: { ...row, commissionBasePrice: null } });
    // Hero = the sale price now; the commission-base price never appears.
    expect(screen.getByText(/800,00/)).toBeInTheDocument();
    expect(screen.queryByText(/780,00/)).toBeNull();
  });

  it('shows the "En kârlı" badge when isBest is set', () => {
    renderCell({ row, isBest: true });
    expect(screen.getByText(/en kârlı/i)).toBeInTheDocument();
  });

  it('hides the "En kârlı" badge by default (no reserved slot)', () => {
    renderCell({ row });
    expect(screen.queryByText(/en kârlı/i)).toBeNull();
  });

  it("opens the breakdown with a scenario:'current' estimate request on badge click", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(ESTIMATE_URL, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          itemId: row.id,
          price: '780.00',
          bandKey: null,
          commissionPct: '19',
          calculable: true,
          reason: null,
          breakdown: null,
        });
      }),
    );
    const { user } = renderCell({ row });
    await user.click(screen.getByRole('button', { name: OPEN_LABEL }));
    // The breakdown dialog opens…
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // …and the current-scenario body carries neither price nor bandKey.
    await waitFor(() => expect(capturedBody).toEqual({ scenario: 'current' }));
  });

  describe('unknown price', () => {
    // Neither GÜNCEL TSF nor KOMİSYONA ESAS FİYAT could be read: the backend has no
    // baseline, so the current profit and margin are null too.
    const unknownRow: CommissionTariffRow = {
      ...row,
      currentPrice: null,
      commissionBasePrice: null,
      currentNetProfit: null,
      currentMarginPct: null,
    };

    it('shows Bilinmiyor and the explanation line, and no ₺0,00, when both prices are unknown', () => {
      renderCell({ row: unknownRow });
      expect(screen.getByText(PRICE_UNKNOWN)).toBeInTheDocument();
      // Never a made-up amount in the hero.
      expect(screen.queryByText(/0,00/)).toBeNull();
      // The commission line and the (empty) profit badge stay.
      expect(screen.getByText(/%19/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: OPEN_LABEL })).toBeInTheDocument();
      // The explanation is visible text (it reads on touch too), not a hover-only hint.
      expect(screen.getByText(PRICE_UNKNOWN_HINT)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: INFO_HINT_LABEL })).toBeNull();
    });

    it('shows the base price when only the current price is unknown', () => {
      renderCell({ row: { ...row, currentPrice: null } });
      expect(screen.getByText(/780,00/)).toBeInTheDocument();
      expect(screen.queryByText(PRICE_UNKNOWN)).toBeNull();
      expect(screen.queryByText(PRICE_UNKNOWN_HINT)).toBeNull();
      expect(screen.queryByRole('button', { name: INFO_HINT_LABEL })).toBeNull();
    });

    it('opens the not-calculable dialog without an estimate request when the price is unknown', async () => {
      let requests = 0;
      server.use(
        http.post(ESTIMATE_URL, () => {
          requests += 1;
          return HttpResponse.json({
            itemId: row.id,
            price: '0.00',
            bandKey: null,
            commissionPct: '19',
            calculable: false,
            reason: null,
            breakdown: null,
          });
        }),
      );
      const { user } = renderCell({ row: unknownRow });
      await user.click(screen.getByRole('button', { name: OPEN_LABEL }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText(NOT_CALCULABLE)).toBeInTheDocument();
      expect(requests).toBe(0);
    });
  });
});
