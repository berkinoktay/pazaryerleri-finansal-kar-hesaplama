import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/orders',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/orders',
  Link: ({
    href,
    children,
    onClick,
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

import { MobileNavSheet } from '@/components/layout/mobile-nav-sheet';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
  mobileNavSheet: { title: 'Menü', close: 'Kapat' },
  contextRail: { ariaLabel: 'Context rail' },
  iconRail: { ariaLabel: 'Icon rail', brandAriaLabel: 'PazarSync' },
  nav: {
    dashboard: 'Pano',
    orders: 'Siparişler',
    products: 'Ürünler',
    profitability: 'Kârlılık',
    reconciliation: 'Mutabakat',
    expenses: 'Giderler',
    settings: 'Ayarlar',
  },
  navSections: {
    orders: {
      status: {
        title: 'Durum',
        all: 'Tümü',
        pending: 'Bekleyen',
        shipped: 'Kargoda',
        delivered: 'Teslim',
        returned: 'İade',
      },
    },
  },
  storeSwitcher: {
    searchPlaceholder: 'Ara',
    empty: '—',
    heading: 'Mağazalar',
    active: 'aktif',
    addStore: 'Yeni mağaza',
  },
};

describe('MobileNavSheet', () => {
  it('renders nav links and the page-specific sub-nav when open', () => {
    render(
      <NextIntlClientProvider locale="tr" messages={messages}>
        <MobileNavSheet
          open
          onOpenChange={() => {}}
          stores={[{ id: 's1', name: 'Trendyol TR', platform: 'TRENDYOL', status: 'active' }]}
          activeStoreId="s1"
          onSelectStore={() => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('link', { name: /Pano/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Siparişler/ })).toBeInTheDocument();
    // sub-nav for /orders
    expect(screen.getByText('Durum')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(
      <NextIntlClientProvider locale="tr" messages={messages}>
        <MobileNavSheet
          open={false}
          onOpenChange={() => {}}
          stores={[]}
          activeStoreId=""
          onSelectStore={() => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('link', { name: /Pano/ })).not.toBeInTheDocument();
  });
});
