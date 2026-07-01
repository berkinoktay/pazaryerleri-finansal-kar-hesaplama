import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PriceBandCell } from '@/features/campaigns/components/price-band-cell';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';
import type { CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

import { render, screen } from '../helpers/render';
import { HttpResponse, http, server } from '../helpers/msw';

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  tariffId: '00000000-0000-0000-0000-000000000003',
};

// band2: a [400, 777.09] window → hero is the upper limit + "ve altı".
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
  currentCommissionPct: '19',
  calculable: true,
  reason: null,
  bestBandKey: 'band2',
  selectedBand: null,
  customPrice: null,
  bands: [band, band, band, band],
};

function renderCell(props: React.ComponentProps<typeof PriceBandCell>) {
  return render(
    <TariffScopeProvider scope={SCOPE}>
      <PriceBandCell {...props} />
    </TariffScopeProvider>,
  );
}

describe('PriceBandCell', () => {
  it('renders a toggle button with the band price, commission, and profit', () => {
    renderCell({ row, band, selected: false, onSelect: vi.fn() });
    // A toggle (aria-pressed), NOT a radio — a band can be deselected.
    const toggle = screen.getByRole('button', { name: /777,09/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // Commission, tr-TR percent formatting of the "13.1" percent string.
    expect(screen.getByText(/13,1/)).toBeInTheDocument();
    // Profit amount via the shared ProfitBadge.
    expect(screen.getByText(/70,79/)).toBeInTheDocument();
  });

  it('reports the click so the parent can toggle selection', async () => {
    const onSelect = vi.fn();
    const { user } = renderCell({ row, band, selected: false, onSelect });
    await user.click(screen.getByRole('button', { name: /777,09/ }));
    expect(onSelect).toHaveBeenCalledWith('band2');
  });

  it('marks the toggle pressed only when selected', () => {
    const { rerender } = renderCell({ row, band, selected: false, onSelect: vi.fn() });
    expect(screen.getByRole('button', { name: /777,09/ })).toHaveAttribute('aria-pressed', 'false');
    rerender(
      <TariffScopeProvider scope={SCOPE}>
        <PriceBandCell row={row} band={band} selected onSelect={vi.fn()} />
      </TariffScopeProvider>,
    );
    expect(screen.getByRole('button', { name: /777,09/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the profit breakdown from the badge without toggling the band', async () => {
    server.use(
      http.post(
        `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/commission-tariffs/${SCOPE.tariffId}/items/:itemId/estimate`,
        () =>
          HttpResponse.json({
            itemId: row.id,
            price: '777.09',
            bandKey: 'band2',
            commissionPct: '13.1',
            calculable: true,
            reason: null,
            breakdown: null,
          }),
      ),
    );
    const onSelect = vi.fn();
    const { user } = renderCell({ row, band, selected: false, onSelect });
    const toggle = screen.getByRole('button', { name: /777,09/ });
    // The badge is the other button in the card (the shared ProfitBadge).
    const badge = screen.getAllByRole('button').find((b) => b !== toggle);
    if (badge === undefined) throw new Error('profit badge button not found');
    await user.click(badge);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
