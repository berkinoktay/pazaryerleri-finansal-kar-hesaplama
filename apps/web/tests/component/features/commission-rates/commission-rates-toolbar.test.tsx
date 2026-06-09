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

  it('switches productScope to active when the "Sattıklarım" segment is clicked', async () => {
    const onProductScopeChange = vi.fn();
    const { user } = render(
      <CommissionRatesToolbar
        q=""
        onSearchChange={() => {}}
        productScope="all"
        onProductScopeChange={onProductScopeChange}
      />,
    );
    // The scope toggle is a FilterTabs segmented control; each option is a tab.
    await user.click(screen.getByRole('tab', { name: 'Sattıklarım' }));
    expect(onProductScopeChange).toHaveBeenCalledWith('active');
  });

  it('switches productScope back to all when the "Tümü" segment is clicked', async () => {
    const onProductScopeChange = vi.fn();
    const { user } = render(
      <CommissionRatesToolbar
        q=""
        onSearchChange={() => {}}
        productScope="active"
        onProductScopeChange={onProductScopeChange}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Tümü' }));
    expect(onProductScopeChange).toHaveBeenCalledWith('all');
  });

  it('names the scope tablist with its accessible group label', () => {
    render(
      <CommissionRatesToolbar
        q=""
        onSearchChange={() => {}}
        productScope="all"
        onProductScopeChange={() => {}}
      />,
    );
    // The group label must reach the role="tablist" element so assistive tech
    // announces what the segment filters (regression guard for FilterTabs
    // forwarding aria-label to TabsList rather than the Radix Root).
    expect(screen.getByRole('tablist', { name: 'Ürün kapsamı' })).toBeInTheDocument();
  });
});
