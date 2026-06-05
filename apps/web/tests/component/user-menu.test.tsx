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
    settings: 'Hesap ayarları',
    theme: { heading: 'Tema', light: 'Açık', dark: 'Koyu', system: 'Sistem' },
    language: { heading: 'Dil' },
    sound: { heading: 'Order notification sound' },
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
    expect(screen.getByText('Hesap ayarları')).toBeInTheDocument();
  });

  it('opens a theme dropdown with three options', async () => {
    const { user } = await openMenu();
    // The theme trigger's accessible name carries the current value ("Tema: Sistem").
    await user.click(await screen.findByRole('button', { name: /Tema/ }));
    expect(await screen.findByRole('menuitemradio', { name: 'Açık' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Koyu' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Sistem' })).toBeInTheDocument();
  });

  it('renders the language flags as Türkçe and English options', async () => {
    await openMenu();
    // Flag toggle items label themselves with the language name (LOCALE_LABELS),
    // not the raw locale code, for screen readers.
    expect(await screen.findByRole('radio', { name: 'Türkçe' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'English' })).toBeInTheDocument();
  });

  it('renders the sign-out item', async () => {
    await openMenu();
    expect(await screen.findByText('Çıkış yap')).toBeInTheDocument();
  });

  it('sound switch is checked by default and unchecks on click', async () => {
    const { user } = await openMenu();
    // The sound Switch is the only role="switch" in the menu (theme is a
    // dropdown, language is a toggle-group -- neither produces a switch role).
    const soundSwitch = await screen.findByRole('switch');
    expect(soundSwitch).toBeChecked();
    await user.click(soundSwitch);
    expect(soundSwitch).not.toBeChecked();
  });
});
