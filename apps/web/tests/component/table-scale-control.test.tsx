import { describe, expect, it, vi } from 'vitest';

import { TableScaleControl } from '@/components/patterns/table-scale-control';

import { render, screen } from '../helpers/render';

describe('TableScaleControl', () => {
  it('renders the current scale as a tr-TR percent', () => {
    render(<TableScaleControl value={0.9} onChange={vi.fn()} />);
    expect(screen.getByText('%90')).toBeInTheDocument();
  });

  it('steps down by 10% (float-safe) on shrink', async () => {
    const onChange = vi.fn();
    const { user } = render(<TableScaleControl value={0.9} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Küçült' }));
    expect(onChange).toHaveBeenCalledWith(0.8);
  });

  it('steps up by 10% on enlarge', async () => {
    const onChange = vi.fn();
    const { user } = render(<TableScaleControl value={0.8} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Büyüt' }));
    expect(onChange).toHaveBeenCalledWith(0.9);
  });

  it('resets to full size when the percent is clicked', async () => {
    const onChange = vi.fn();
    const { user } = render(<TableScaleControl value={0.8} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Normal boyut' }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('disables shrink at the minimum and enlarge at the maximum', () => {
    const { rerender } = render(<TableScaleControl value={0.7} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Küçült' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Büyüt' })).toBeEnabled();

    rerender(<TableScaleControl value={1.2} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Büyüt' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Küçült' })).toBeEnabled();
  });
});
