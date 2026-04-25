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

import { ContextRail } from '@/components/layout/context-rail';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
  contextRail: { ariaLabel: 'Context rail' },
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
    empty: 'Bulunamadı',
    heading: 'Mağazalar',
    active: 'aktif',
    addStore: 'Yeni mağaza',
  },
};

const stores = [
  { id: 's1', name: 'Trendyol TR', platform: 'TRENDYOL' as const, status: 'active' as const },
];

function renderRail() {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <ContextRail
        orgSwitcher={<span>org</span>}
        stores={stores}
        activeStoreId="s1"
        onSelectStore={() => undefined}
      />
    </NextIntlClientProvider>,
  );
}

describe('ContextRail', () => {
  it('renders the org switcher in the top slot', () => {
    renderRail();
    expect(screen.getByText('org')).toBeInTheDocument();
  });

  it('renders the active store switcher', () => {
    renderRail();
    expect(screen.getByText('Trendyol TR')).toBeInTheDocument();
  });

  it('renders the page-specific sub-nav for /orders', () => {
    renderRail();
    expect(screen.getByText('Durum')).toBeInTheDocument();
    expect(screen.getByText('Tümü')).toBeInTheDocument();
    expect(screen.getByText('Bekleyen')).toBeInTheDocument();
  });

  it('does NOT render a "Şimdi senkronize et" button (bottom removed)', () => {
    renderRail();
    expect(screen.queryByText(/senkronize et/i)).not.toBeInTheDocument();
  });

  it('does NOT render a language switcher (moved to user menu)', () => {
    renderRail();
    expect(screen.queryByRole('button', { name: /Dil/i })).not.toBeInTheDocument();
  });
});
