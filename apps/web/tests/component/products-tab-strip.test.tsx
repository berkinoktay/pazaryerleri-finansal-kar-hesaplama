import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { ProductsTabStrip } from '@/features/products/components/products-tab-strip';
import { FORMATS } from '@/i18n/formats';

import { render, screen } from '../helpers/render';

const messages = {
  products: {
    overrideTabs: {
      all: 'Tümü',
      missingCost: 'Maliyeti girilmemiş',
      missingVat: 'KDV girilmemiş',
    },
  },
};

function renderStrip(props: Parameters<typeof ProductsTabStrip>[0]) {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages} formats={FORMATS}>
      <ProductsTabStrip {...props} />
    </NextIntlClientProvider>,
  );
}

describe('ProductsTabStrip', () => {
  it('renders 3 tabs with formatted counts', () => {
    renderStrip({
      value: 'all',
      counts: { missingCost: 117, missingVat: 92, total: 118 },
      onChange: () => {},
    });
    expect(screen.getByRole('tab', { name: /Tümü/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Maliyeti girilmemiş/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /KDV girilmemiş/ })).toBeInTheDocument();
    expect(screen.getByText('118')).toBeInTheDocument();
    expect(screen.getByText('117')).toBeInTheDocument();
    expect(screen.getByText('92')).toBeInTheDocument();
  });

  it('calls onChange with the right value when a tab is clicked', async () => {
    const onChange = vi.fn();
    const { user } = renderStrip({
      value: 'all',
      counts: { missingCost: 117, missingVat: 92, total: 118 },
      onChange,
    });
    await user.click(screen.getByRole('tab', { name: /Maliyeti girilmemiş/ }));
    expect(onChange).toHaveBeenCalledWith('cost');
  });

  it('renders without counts (loading or facets undefined)', () => {
    renderStrip({ value: 'all', loading: true, onChange: () => {} });
    expect(screen.getByRole('tab', { name: /Tümü/ })).toBeInTheDocument();
  });
});
