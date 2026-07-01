import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { PriceBandCell } from '@/features/campaigns/components/price-band-cell';
import type { CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

import { render, screen } from '../helpers/render';

const band: PriceBand = {
  key: 'band2',
  thresholdLabel: '777,09₺ ve altı',
  threshold: new Decimal('777.09'),
  commissionPct: new Decimal('0.131'),
  profit: new Decimal('70.79'),
  marginPct: '9.11',
};

const row: CommissionTariffRow = {
  id: 'r1',
  productTitle: 'Test Ürün',
  category: 'Bayrak',
  brand: 'Marka',
  modelCode: 'M1',
  barcode: '123',
  stock: 10,
  currentPrice: new Decimal('800'),
  displayPrice: new Decimal('800'),
  currentCommissionPct: new Decimal('0.19'),
  unitCost: new Decimal('600'),
  bands: [band, band, band, band],
  bestBand: 'band2',
};

describe('PriceBandCell', () => {
  it('renders a toggle button with the band price, commission, and profit', () => {
    render(<PriceBandCell row={row} band={band} selected={false} onSelect={vi.fn()} />);
    // A toggle (aria-pressed), NOT a radio — a band can be deselected.
    const toggle = screen.getByRole('button', { name: /777,09₺/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // Price is the hero, split out of the threshold label.
    expect(screen.getByText('777,09₺')).toBeInTheDocument();
    // Commission, tr-TR percent formatting of 0.131.
    expect(screen.getByText(/13,1/)).toBeInTheDocument();
    // Profit amount via the shared ProfitBadge.
    expect(screen.getByText(/70,79/)).toBeInTheDocument();
  });

  it('reports the click so the parent can toggle selection', async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <PriceBandCell row={row} band={band} selected={false} onSelect={onSelect} />,
    );
    await user.click(screen.getByRole('button', { name: /777,09₺/ }));
    expect(onSelect).toHaveBeenCalledWith('band2');
  });

  it('marks the toggle pressed only when selected', () => {
    const { rerender } = render(
      <PriceBandCell row={row} band={band} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /777,09₺/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    rerender(<PriceBandCell row={row} band={band} selected onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /777,09₺/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the profit breakdown from the badge without toggling the band', async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <PriceBandCell row={row} band={band} selected={false} onSelect={onSelect} />,
    );
    const toggle = screen.getByRole('button', { name: /777,09₺/ });
    // The badge is the other button in the card (the shared ProfitBadge).
    const badge = screen.getAllByRole('button').find((b) => b !== toggle);
    if (badge === undefined) throw new Error('profit badge button not found');
    await user.click(badge);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
