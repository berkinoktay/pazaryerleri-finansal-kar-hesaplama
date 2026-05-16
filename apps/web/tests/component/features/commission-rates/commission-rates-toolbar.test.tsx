import { describe, expect, it, vi } from 'vitest';

import { CommissionRatesToolbar } from '@/features/commission-rates/components/commission-rates-toolbar';

import { render, screen } from '../../../helpers/render';

describe('CommissionRatesToolbar', () => {
  it('renders search input with the search placeholder and current value', () => {
    render(
      <CommissionRatesToolbar
        q="çanta"
        onSearchChange={() => {}}
        productScope="all"
        onProductScopeChange={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText(/Kategori, üst kategori veya marka ara/)).toHaveValue(
      'çanta',
    );
  });

  it('fires onSearchChange on each keystroke', async () => {
    const onSearchChange = vi.fn();
    const { user } = render(
      <CommissionRatesToolbar
        q=""
        onSearchChange={onSearchChange}
        productScope="all"
        onProductScopeChange={() => {}}
      />,
    );
    await user.type(screen.getByPlaceholderText(/Kategori, üst kategori veya marka ara/), 'a');
    expect(onSearchChange).toHaveBeenCalledWith('a');
  });

  it('toggles productScope to active when checkbox is checked', async () => {
    const onProductScopeChange = vi.fn();
    const { user } = render(
      <CommissionRatesToolbar
        q=""
        onSearchChange={() => {}}
        productScope="all"
        onProductScopeChange={onProductScopeChange}
      />,
    );
    await user.click(screen.getByLabelText('Sadece sattıklarım'));
    expect(onProductScopeChange).toHaveBeenCalledWith('active');
  });

  it('toggles productScope back to all when unchecked', async () => {
    const onProductScopeChange = vi.fn();
    const { user } = render(
      <CommissionRatesToolbar
        q=""
        onSearchChange={() => {}}
        productScope="active"
        onProductScopeChange={onProductScopeChange}
      />,
    );
    await user.click(screen.getByLabelText('Sadece sattıklarım'));
    expect(onProductScopeChange).toHaveBeenCalledWith('all');
  });
});
