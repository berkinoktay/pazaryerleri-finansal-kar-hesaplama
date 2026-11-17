import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PriceBandCell } from '@/features/campaigns/components/price-band-cell';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';
import type { CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

import { render, screen, within } from '../helpers/render';
import { HttpResponse, http, server } from '../helpers/msw';
import trMessages from '../../messages/tr.json';

const OPEN_LABEL = trMessages.profitBadge.open;
const INFO_HINT_LABEL = trMessages.common.infoHint;
const PRICE_UNKNOWN = trMessages.commissionTariffsPage.table.priceUnknown;
const BAND_PRICE_UNKNOWN_HINT = trMessages.commissionTariffsPage.table.bandPriceUnknownHint;
const BAND_NOT_SELECTABLE = trMessages.commissionTariffsPage.table.bandNotSelectable;
const VS_CURRENT = trMessages.commissionTariffsPage.table.vsCurrent;
const NOT_CALCULABLE = trMessages.profitBreakdown.notCalculable;

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  tariffId: '00000000-0000-0000-0000-000000000003',
};

const ESTIMATE_URL = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/commission-tariffs/${SCOPE.tariffId}/items/:itemId/estimate`;

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

function renderCell(props: React.ComponentProps<typeof PriceBandCell>) {
  return render(
    <TariffScopeProvider scope={SCOPE}>
      <PriceBandCell {...props} />
    </TariffScopeProvider>,
  );
}

describe('PriceBandCell', () => {
  it('renders the band price, commission, profit, and a select toggle', () => {
    renderCell({ row, band, selected: false, onSelect: vi.fn() });
    // Price hero + its "ve altı" qualifier.
    expect(screen.getByText(/777,09/)).toBeInTheDocument();
    // Commission, tr-TR percent formatting of the "13.1" percent string.
    expect(screen.getByText(/13,1/)).toBeInTheDocument();
    // Profit amount via the shared ProfitBadge.
    expect(screen.getByText(/70,79/)).toBeInTheDocument();
    // The one selection affordance — a toggle (aria-pressed), NOT a radio.
    const toggle = screen.getByRole('button', { name: /aralığı seç/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the click so the parent can toggle selection', async () => {
    const onSelect = vi.fn();
    const { user } = renderCell({ row, band, selected: false, onSelect });
    await user.click(screen.getByRole('button', { name: /aralığı seç/i }));
    expect(onSelect).toHaveBeenCalledWith('band2');
  });

  it('shows the selected label + pressed state when selected', () => {
    const { rerender } = renderCell({ row, band, selected: false, onSelect: vi.fn() });
    expect(screen.getByRole('button', { name: /aralığı seç/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    rerender(
      <TariffScopeProvider scope={SCOPE}>
        <PriceBandCell row={row} band={band} selected onSelect={vi.fn()} />
      </TariffScopeProvider>,
    );
    // Selected → the "Seçildi" label + pressed state.
    expect(screen.getByRole('button', { name: /seçildi/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows the "En kârlı" marker only for the best band', () => {
    // The marker is now an absolute ribbon rendered ONLY for the best band (no
    // reserved slot), so non-best cards stay short.
    const { rerender } = renderCell({
      row,
      band,
      selected: false,
      isBest: false,
      onSelect: vi.fn(),
    });
    expect(screen.queryByText(/en kârlı/i)).toBeNull();
    rerender(
      <TariffScopeProvider scope={SCOPE}>
        <PriceBandCell row={row} band={band} selected={false} isBest onSelect={vi.fn()} />
      </TariffScopeProvider>,
    );
    expect(screen.getByText(/en kârlı/i)).toBeInTheDocument();
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
    const toggle = screen.getByRole('button', { name: /aralığı seç/i });
    // The badge is the other button in the cell (the shared ProfitBadge).
    const badge = screen.getAllByRole('button').find((b) => b !== toggle);
    if (badge === undefined) throw new Error('profit badge button not found');
    await user.click(badge);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('hides the Güncele göre line when the current profit is null', () => {
    const { rerender } = renderCell({ row, band, selected: false, onSelect: vi.fn() });
    // Control: with a known current profit the band shows its difference to it.
    expect(screen.getByText(VS_CURRENT, { exact: false })).toBeInTheDocument();
    rerender(
      <TariffScopeProvider scope={SCOPE}>
        <PriceBandCell
          row={{ ...row, currentNetProfit: null, currentMarginPct: null }}
          band={band}
          selected={false}
          onSelect={vi.fn()}
        />
      </TariffScopeProvider>,
    );
    // The band keeps its own profit, but there is no baseline to compare it against.
    expect(screen.getByText(/70,79/)).toBeInTheDocument();
    expect(screen.queryByText(VS_CURRENT, { exact: false })).toBeNull();
  });

  describe('band with no price', () => {
    // band1 with neither limit while the row's current price is unknown: the backend
    // sends price null and no profit for it.
    const noPriceBand: PriceBand = {
      key: 'band1',
      lowerLimit: null,
      upperLimit: null,
      price: null,
      commissionPct: '19',
      netProfit: null,
      marginPct: null,
    };
    const unknownRow: CommissionTariffRow = {
      ...row,
      currentPrice: null,
      commissionBasePrice: null,
      currentNetProfit: null,
      currentMarginPct: null,
      bestBandKey: null,
      bands: [noPriceBand, band],
    };

    it('shows Bilinmiyor and cannot be selected when the band has no price', async () => {
      const onSelect = vi.fn();
      const { user } = renderCell({
        row: unknownRow,
        band: noPriceBand,
        selected: false,
        // Even a caller that marks it best gets no ribbon: a band with no price never wins.
        isBest: true,
        onSelect,
      });
      expect(screen.getByText(PRICE_UNKNOWN)).toBeInTheDocument();
      expect(screen.queryByText(/0,00/)).toBeNull();
      expect(screen.queryByText(/en kârlı/i)).toBeNull();
      // No select target; the foot says it cannot be selected.
      expect(screen.queryByRole('button', { name: /aralığı seç/i })).toBeNull();
      expect(screen.getByText(BAND_NOT_SELECTABLE)).toBeInTheDocument();
      await user.click(screen.getByText(PRICE_UNKNOWN));
      await user.click(screen.getByText(BAND_NOT_SELECTABLE));
      expect(onSelect).not.toHaveBeenCalled();
      // The explanation is a visible line under Bilinmiyor (it reads on touch too), not
      // a hover-only hint.
      const hint = screen.getByText(BAND_PRICE_UNKNOWN_HINT);
      expect(
        screen.getByText(PRICE_UNKNOWN).compareDocumentPosition(hint) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: INFO_HINT_LABEL })).toBeNull();
    });

    it('shows no explanation line on a band with a price', () => {
      renderCell({ row: unknownRow, band, selected: false, onSelect: vi.fn() });
      expect(screen.queryByText(PRICE_UNKNOWN)).toBeNull();
      expect(screen.queryByText(BAND_PRICE_UNKNOWN_HINT)).toBeNull();
    });

    it('can still be deselected when a band with no price is selected', async () => {
      const onSelect = vi.fn();
      const { user } = renderCell({ row: unknownRow, band: noPriceBand, selected: true, onSelect });
      const toggle = screen.getByRole('button', { name: /seçildi/i });
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await user.click(toggle);
      expect(onSelect).toHaveBeenCalledWith('band1');
    });

    it('sends no estimate request for a band with no price', async () => {
      let requests = 0;
      server.use(
        http.post(ESTIMATE_URL, () => {
          requests += 1;
          return HttpResponse.json({
            itemId: row.id,
            price: '0.00',
            bandKey: 'band1',
            commissionPct: '19',
            calculable: false,
            reason: null,
            breakdown: null,
          });
        }),
      );
      const onSelect = vi.fn();
      const { user } = renderCell({
        row: unknownRow,
        band: noPriceBand,
        selected: false,
        onSelect,
      });
      await user.click(screen.getByRole('button', { name: OPEN_LABEL }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText(NOT_CALCULABLE)).toBeInTheDocument();
      expect(requests).toBe(0);
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
