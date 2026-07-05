import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CustomPriceCell } from '@/features/campaigns/components/custom-price-cell';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';
import type { CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

import { render, screen } from '../helpers/render';

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000001',
  storeId: '00000000-0000-0000-0000-000000000002',
  tariffId: '00000000-0000-0000-0000-000000000003',
};

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
  it('shows the always-visible profit block + a disabled select when empty', () => {
    renderCell({ row, isSelected: false, onSelect: vi.fn(), onDeselect: vi.fn() });
    expect(screen.getByPlaceholderText(/fiyat girin/i)).toBeInTheDocument();
    // Before a price is typed, the derived line shows the "type a price" hint.
    expect(screen.getByText(/fiyat girince tahmini kâr/i)).toBeInTheDocument();
    // The select is disabled until a calculable estimate for a typed price is in.
    expect(screen.getByRole('button', { name: /bu fiyatı seç/i })).toBeDisabled();
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
});
