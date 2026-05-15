import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { CommissionRatesEmptyState } from '@/features/commission-rates/components/commission-rates-empty-state';

import { render, screen } from '../../../helpers/render';

describe('CommissionRatesEmptyState', () => {
  it('renders the no-store variant with a CTA link to /settings/stores', () => {
    render(<CommissionRatesEmptyState variant="no-store" />);
    expect(screen.getByText('Aktif mağaza yok')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mağaza bağla' })).toHaveAttribute(
      'href',
      expect.stringContaining('/settings/stores'),
    );
  });

  it('renders the no-rates variant without an action', () => {
    render(<CommissionRatesEmptyState variant="no-rates" />);
    expect(screen.getByText('Komisyon tarifesi henüz yüklenmedi')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the no-matches variant with a Filtreyi temizle action', async () => {
    const onClear = vi.fn();
    const { user } = render(
      <CommissionRatesEmptyState variant="no-matches" onClearFilters={onClear} />,
    );
    expect(screen.getByText('Filtreyle eşleşen oran bulunamadı')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filtreyi temizle' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
