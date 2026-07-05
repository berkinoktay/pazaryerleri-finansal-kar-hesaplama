import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { CurrentPriceCell } from '@/features/campaigns/components/current-price-cell';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';
import type { CommissionTariffRow } from '@/features/campaigns/types';

import { render, screen, waitFor } from '../helpers/render';
import { HttpResponse, http, server } from '../helpers/msw';
import trMessages from '../../messages/tr.json';

const OPEN_LABEL = trMessages.profitBadge.open;

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
});
