import { describe, expect, it, vi } from 'vitest';

import { MissingShippingBanner } from '@/features/products/components/missing-shipping-banner';

import { render, screen } from '../../../helpers/render';

describe('MissingShippingBanner', () => {
  it('renders nothing when total is 0', () => {
    const { container } = render(
      <MissingShippingBanner
        counts={{ total: 0, noDesi: 0, noCarrier: 0, overflow: 0 }}
        onFilterApply={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders banner with aggregate counts in the title and breakdown', () => {
    render(
      <MissingShippingBanner
        counts={{ total: 23, noDesi: 12, noCarrier: 8, overflow: 3 }}
        onFilterApply={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    // Title contains the total count
    expect(alert).toHaveTextContent('23');
    // Breakdown surfaces each category count
    expect(alert).toHaveTextContent('12');
    expect(alert).toHaveTextContent('8');
    expect(alert).toHaveTextContent('3');
  });

  it('invokes onFilterApply when the CTA is clicked', async () => {
    const onFilterApply = vi.fn();
    const { user } = render(
      <MissingShippingBanner
        counts={{ total: 5, noDesi: 5, noCarrier: 0, overflow: 0 }}
        onFilterApply={onFilterApply}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Etkilenen ürünleri filtrele' });
    await user.click(btn);
    expect(onFilterApply).toHaveBeenCalledOnce();
  });

  it('lists only the reasons that actually occur (zero counts are noise)', () => {
    render(
      <MissingShippingBanner
        counts={{ total: 1, noDesi: 0, noCarrier: 1, overflow: 0 }}
        onFilterApply={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('kargo firması seçilmemiş (1)');
    expect(alert).not.toHaveTextContent('desi eksik');
    expect(alert).not.toHaveTextContent('yüksek desi');
  });
});
