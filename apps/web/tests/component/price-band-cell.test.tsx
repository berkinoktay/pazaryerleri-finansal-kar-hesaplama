import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { PriceBandCell } from '@/features/campaigns/components/price-band-cell';
import type { PriceBand } from '@/features/campaigns/types';

import { render, screen } from '../helpers/render';

const band: PriceBand = {
  key: 'band2',
  thresholdLabel: '777,09₺ ve altı',
  commissionPct: new Decimal('0.131'),
  profit: new Decimal('70.79'),
  marginPct: '9.11',
};

describe('PriceBandCell', () => {
  it('renders the band as a radio and reports its commission rate', () => {
    render(<PriceBandCell band={band} selected={false} onSelect={vi.fn()} />);
    const radio = screen.getByRole('radio');
    expect(radio).toBeInTheDocument();
    // tr-TR percent formatting of 0.131
    expect(radio).toHaveTextContent('%13,1');
  });

  it('calls onSelect with the band key when clicked', async () => {
    const onSelect = vi.fn();
    const { user } = render(<PriceBandCell band={band} selected={false} onSelect={onSelect} />);
    await user.click(screen.getByRole('radio'));
    expect(onSelect).toHaveBeenCalledWith('band2');
  });

  it('marks the radio checked only when selected', () => {
    const { rerender } = render(<PriceBandCell band={band} selected={false} onSelect={vi.fn()} />);
    expect(screen.getByRole('radio')).not.toBeChecked();
    rerender(<PriceBandCell band={band} selected onSelect={vi.fn()} />);
    expect(screen.getByRole('radio')).toBeChecked();
  });
});
