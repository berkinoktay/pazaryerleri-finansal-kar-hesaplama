import { describe, expect, it, vi } from 'vitest';

import { ProductPricingToolbar } from '@/features/product-pricing/components/product-pricing-toolbar';

import { render, screen } from '../../../helpers/render';

/** Minimal default props — every test overrides only what it exercises. */
const defaultProps = {
  q: '',
  onSearchChange: () => {},
  marginMin: '',
  marginMax: '',
  onMarginMinChange: () => {},
  onMarginMaxChange: () => {},
  categoryId: '',
  brandId: '',
  onCategoryChange: () => {},
  onBrandChange: () => {},
  lossOnly: false,
  onLossOnlyChange: () => {},
  facets: undefined,
  facetsLoading: false,
} as const;

describe('ProductPricingToolbar', () => {
  it('renders the search input with the placeholder text', () => {
    render(<ProductPricingToolbar {...defaultProps} />);
    expect(screen.getByPlaceholderText('Ürün, SKU veya barkod ara')).toBeInTheDocument();
  });

  it('calls onSearchChange with the typed value on each keystroke', async () => {
    const onSearchChange = vi.fn();
    const { user } = render(
      <ProductPricingToolbar {...defaultProps} onSearchChange={onSearchChange} />,
    );
    await user.type(screen.getByPlaceholderText('Ürün, SKU veya barkod ara'), 'k');
    expect(onSearchChange).toHaveBeenCalledWith('k');
  });

  it('calls onLossOnlyChange when the loss-only switch is toggled', async () => {
    const onLossOnlyChange = vi.fn();
    const { user } = render(
      <ProductPricingToolbar {...defaultProps} onLossOnlyChange={onLossOnlyChange} />,
    );
    // The switch label "Sadece zarar edenleri göster" wraps the Switch via htmlFor.
    await user.click(screen.getByRole('switch', { name: /Sadece zarar edenleri göster/i }));
    expect(onLossOnlyChange).toHaveBeenCalledWith(true);
  });

  it('calls onLossOnlyChange with false when already checked switch is toggled', async () => {
    const onLossOnlyChange = vi.fn();
    const { user } = render(
      <ProductPricingToolbar
        {...defaultProps}
        lossOnly={true}
        onLossOnlyChange={onLossOnlyChange}
      />,
    );
    await user.click(screen.getByRole('switch', { name: /Sadece zarar edenleri göster/i }));
    expect(onLossOnlyChange).toHaveBeenCalledWith(false);
  });

  it('calls onCategoryChange with the selected category id when a facet option is clicked', async () => {
    const onCategoryChange = vi.fn();
    const { user } = render(
      <ProductPricingToolbar
        {...defaultProps}
        onCategoryChange={onCategoryChange}
        facets={{
          categories: [{ id: '411', name: 'Spor Ayakkabı', count: 3 }],
          brands: [],
          overrideCounts: { missingCost: 0, missingVat: 0, total: 0 },
        }}
      />,
    );

    // Open the category select via its accessible label
    await user.click(screen.getByRole('combobox', { name: /Kategori/i }));
    await user.click(screen.getByRole('option', { name: 'Spor Ayakkabı' }));
    expect(onCategoryChange).toHaveBeenCalledWith('411');
  });

  it('calls onBrandChange with the selected brand id when a facet option is clicked', async () => {
    const onBrandChange = vi.fn();
    const { user } = render(
      <ProductPricingToolbar
        {...defaultProps}
        onBrandChange={onBrandChange}
        facets={{
          categories: [],
          brands: [{ id: '200', name: 'Nike', count: 5 }],
          overrideCounts: { missingCost: 0, missingVat: 0, total: 0 },
        }}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: /Marka/i }));
    await user.click(screen.getByRole('option', { name: 'Nike' }));
    expect(onBrandChange).toHaveBeenCalledWith('200');
  });
});
