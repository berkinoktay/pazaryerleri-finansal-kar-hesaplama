import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { ProductsFacetChips } from '@/features/products/components/products-facet-chips';
import { FORMATS } from '@/i18n/formats';

import { render, screen } from '../helpers/render';

const messages = {
  products: {
    facets: {
      brand: {
        trigger: '+ Marka',
        active: 'Marka: {name}',
        clear: 'Markayı temizle',
        search: 'Marka ara…',
        noResults: 'Sonuç yok',
      },
      category: {
        trigger: '+ Kategori',
        active: 'Kategori: {name}',
        clear: 'Kategoriyi temizle',
        search: 'Kategori ara…',
        noResults: 'Sonuç yok',
      },
      status: {
        trigger: '+ Durum',
        active: 'Durum: {label}',
        clear: 'Durumu temizle',
      },
    },
    filters: {
      statusOptions: {
        onSale: 'Satışta',
        archived: 'Arşivde',
        locked: 'Kilitli',
        blacklisted: 'Engelli',
      },
    },
  },
};

function renderChips(props: Parameters<typeof ProductsFacetChips>[0]) {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages} formats={FORMATS}>
      <ProductsFacetChips {...props} />
    </NextIntlClientProvider>,
  );
}

describe('ProductsFacetChips', () => {
  it('renders ghost chips when no facet is active', () => {
    renderChips({
      brand: '',
      category: '',
      status: 'onSale',
      brandOptions: [{ value: 'b1', label: 'BrandOne', count: 5 }],
      categoryOptions: [],
      onBrandChange: () => {},
      onCategoryChange: () => {},
      onStatusChange: () => {},
    });
    expect(screen.getByRole('button', { name: /\+ Marka/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Kategori/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Durum/ })).toBeInTheDocument();
  });

  it("clears a facet when the active chip's clear button is clicked", async () => {
    const onBrandChange = vi.fn();
    const { user } = renderChips({
      brand: 'b1',
      category: '',
      status: 'onSale',
      brandOptions: [{ value: 'b1', label: 'BrandOne', count: 5 }],
      categoryOptions: [],
      onBrandChange,
      onCategoryChange: () => {},
      onStatusChange: () => {},
    });
    await user.click(screen.getByRole('button', { name: 'Markayı temizle' }));
    expect(onBrandChange).toHaveBeenCalledWith('');
  });

  it('renders the active brand label inside the trigger', () => {
    renderChips({
      brand: 'b1',
      category: '',
      status: 'onSale',
      brandOptions: [{ value: 'b1', label: 'BrandOne', count: 5 }],
      categoryOptions: [],
      onBrandChange: () => {},
      onCategoryChange: () => {},
      onStatusChange: () => {},
    });
    expect(screen.getByRole('button', { name: 'Marka: BrandOne' })).toBeInTheDocument();
  });
});
