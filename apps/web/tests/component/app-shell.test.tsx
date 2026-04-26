import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/dashboard',
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

vi.mock('@/features/auth/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { email: 'b@example.com' } }),
}));

vi.mock('@/features/auth/hooks/use-sign-out', () => ({
  useSignOut: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() }),
}));

import { AppShell } from '@/components/layout/app-shell';
import { type Organization, type Store } from '@/components/patterns/org-store-switcher';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
  nav: {
    dashboard: 'Pano',
    orders: 'Siparişler',
    products: 'Ürünler',
    profitability: 'Karlılık',
    reconciliation: 'Mutabakat',
    expenses: 'Giderler',
    settings: 'Ayarlar',
    notifications: 'Bildirimler',
    support: 'Destek',
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
    products: {
      catalog: {
        title: 'Katalog',
        active: 'Aktif',
        draft: 'Taslak',
        noCost: 'Maliyetsiz',
        noDesi: 'Desisiz',
        lowStock: 'Düşük stok',
      },
      meta: { title: 'Ek bilgiler', costs: 'Maliyetler' },
    },
    profitability: {
      reports: {
        title: 'Raporlar',
        order: 'Sipariş',
        product: 'Ürün',
        category: 'Kategori',
        return: 'İade',
        campaign: 'Reklam',
      },
    },
    reconciliation: {
      status: {
        title: 'Durum',
        matched: 'Eşleşen',
        pending: 'Bekleyen',
        mismatch: 'Uyumsuz',
      },
    },
    expenses: {
      category: {
        title: 'Kategori',
        all: 'Tümü',
        product: 'Ürün',
        ad: 'Reklam',
        packaging: 'Paketleme',
        other: 'Diğer',
      },
    },
    settings: {
      sections: {
        title: 'Bölümler',
        profile: 'Profil',
        team: 'Ekip',
        billing: 'Fatura',
        stores: 'Mağazalar',
        notifications: 'Bildirimler',
      },
    },
    notifications: {
      filter: {
        title: 'Filtre',
        all: 'Tümü',
        unread: 'Okunmamış',
        sync: 'Senkron',
        orders: 'Sipariş',
        warning: 'Uyarı',
      },
    },
  },
  orgStoreSwitcher: {
    search: 'Org veya mağaza ara…',
    sectionOrgs: 'Organizasyonlar',
    sectionStores: 'Mağazalar',
    addOrg: '+ Yeni',
    connectStore: '+ Bağla',
    footerOrgSettings: 'Org ayarları',
    footerStoreManagement: 'Mağaza yönetimi',
    footerNewOrg: '+ Yeni Org',
    emptyTitle: 'Henüz bir organizasyona sahip değilsin',
    emptyDescription: 'Bir organizasyon oluştur ya da bir davete katıl.',
    emptyCreate: '+ Yeni Organizasyon Oluştur',
    emptyJoinInvite: 'Davet Kodum Var',
    roleOwner: 'Owner',
    roleAdmin: 'Admin',
    roleMember: 'Member',
    syncStateFresh: 'Senkron',
    syncStateStale: 'Yenile',
    syncStateFailed: 'Senkron başarısız',
    openShortcut: '⌘O ile değiştir',
  },
  themeToggle: { label: 'Tema' },
  notificationBell: {
    label: 'Bildirimler',
    empty: 'Bildirim yok',
    seeAll: 'Hepsini gör',
  },
  userMenu: {
    open: 'Kullanıcı menüsünü aç',
    profile: 'Profil',
    settings: 'Ayarlar',
    theme: { heading: 'Tema', light: 'Açık', dark: 'Koyu', system: 'Sistem' },
    language: { heading: 'Dil' },
    help: { docs: 'Yardım', shortcuts: 'Kısayollar', feedback: 'Geri bildirim' },
  },
  auth: { userMenu: { signOut: 'Çıkış yap' } },
};

const mockOrgs: Organization[] = [
  {
    id: 'org-a',
    name: 'Acme A.Ş.',
    role: 'OWNER',
    storeCount: 2,
    lastSyncedAt: '2026-04-25T11:55:00Z',
    lastAccessedAt: '2026-04-25T12:00:00Z',
  },
];

const mockStores: Store[] = [
  {
    id: 'store-1',
    name: 'Trendyol Acme TR',
    platform: 'TRENDYOL',
    syncState: 'fresh',
    lastSyncedAt: '2026-04-25T11:55:00Z',
  },
];

interface RenderProps {
  orgs?: Organization[];
  stores?: Store[];
  activeOrgId?: string | undefined;
  activeStoreId?: string | undefined;
  onSelectOrg?: (id: string) => void;
  onSelectStore?: (id: string) => void;
}

function renderShell(props: RenderProps = {}) {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <AppShell
        orgs={props.orgs ?? mockOrgs}
        stores={props.stores ?? mockStores}
        activeOrgId={props.activeOrgId ?? 'org-a'}
        activeStoreId={props.activeStoreId ?? 'store-1'}
        onSelectOrg={props.onSelectOrg ?? vi.fn()}
        onSelectStore={props.onSelectStore ?? vi.fn()}
      >
        <div data-testid="page-content">Hello dashboard</div>
      </AppShell>
    </NextIntlClientProvider>,
  );
}

describe('AppShell', () => {
  it('renders children inside the <main> landmark', () => {
    renderShell();
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    expect(main).toContainElement(screen.getByTestId('page-content'));
  });

  it('renders at least one SidebarTrigger (accessible name "Toggle Sidebar")', () => {
    renderShell();
    // Both desktop (sidebar header) + mobile (inline header) triggers render to the DOM.
    // CSS controls which is visible by viewport.
    const triggers = screen.getAllByRole('button', { name: /toggle sidebar/i });
    expect(triggers.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the OrgStoreSwitcher with the active org name', () => {
    renderShell();
    expect(screen.getByText('Acme A.Ş.')).toBeInTheDocument();
  });

  it('renders desktop and mobile triggers so CSS can pick which to show', () => {
    renderShell();
    // Desktop trigger lives inside the SidebarHeader; mobile trigger is in the
    // mobile-only inline header at the top of <SidebarInset>.  Both should
    // render to the DOM regardless of viewport — CSS handles visibility.
    const triggers = screen.getAllByRole('button', { name: /toggle sidebar/i });
    expect(triggers.length).toBeGreaterThanOrEqual(2);
  });

  it('renders top-level nav entries with translated labels', () => {
    renderShell();
    expect(screen.getByText('Pano')).toBeInTheDocument();
    expect(screen.getByText('Siparişler')).toBeInTheDocument();
    expect(screen.getByText('Ürünler')).toBeInTheDocument();
  });
});
