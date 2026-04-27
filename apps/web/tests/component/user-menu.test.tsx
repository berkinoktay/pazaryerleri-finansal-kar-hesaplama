import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

vi.mock('@/features/auth/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { email: 'b@example.com', fullName: 'Berkin' } }),
}));
vi.mock('@/features/auth/hooks/use-sign-out', () => ({
  useSignOut: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/dashboard',
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { UserMenu } from '@/features/auth/components/user-menu';
import { SidebarProvider } from '@/components/ui/sidebar';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
  auth: { userMenu: { signOut: 'Çıkış yap' } },
  userMenu: {
    open: 'Kullanıcı menüsünü aç',
    profile: 'Profil',
    settings: 'Ayarlar',
    theme: { heading: 'Tema', light: 'Açık', dark: 'Koyu', system: 'Sistem' },
    language: { heading: 'Dil' },
    help: { docs: 'Yardım', shortcuts: 'Kısayollar', feedback: 'Geri bildirim' },
  },
};

async function openMenu() {
  // UserMenu reads the sidebar collapse state via useSidebar() to flip
  // the popover side and trim the trigger height. Wrap in SidebarProvider
  // so the hook resolves; defaultOpen keeps the menu's expanded layout.
  const utils = render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <SidebarProvider defaultOpen>
        <UserMenu />
      </SidebarProvider>
    </NextIntlClientProvider>,
  );
  // The popover trigger is the only sidebar-menu-button rendered here;
  // SidebarProvider's TooltipProvider also renders no buttons of its own.
  const triggers = screen.getAllByRole('button');
  await utils.user.click(triggers[0]!);
  return utils;
}

describe('UserMenu', () => {
  it('shows the email in the dropdown header', async () => {
    await openMenu();
    // Email surfaces in two places in the redesigned menu — beside the
    // avatar inside the trigger row AND in the popover identity header
    // — both are valid; assert presence of at least one.
    const matches = await screen.findAllByText('b@example.com');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders profile and settings items', async () => {
    await openMenu();
    expect(await screen.findByText('Profil')).toBeInTheDocument();
    expect(screen.getByText('Ayarlar')).toBeInTheDocument();
  });

  it('renders the theme segmented control with three options', async () => {
    await openMenu();
    expect(await screen.findByRole('radio', { name: 'Açık' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Koyu' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sistem' })).toBeInTheDocument();
  });

  it('renders the language segmented control with TR + EN', async () => {
    await openMenu();
    expect(await screen.findByRole('radio', { name: 'TR' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'EN' })).toBeInTheDocument();
  });

  it('renders the sign-out item', async () => {
    await openMenu();
    expect(await screen.findByText('Çıkış yap')).toBeInTheDocument();
  });
});
