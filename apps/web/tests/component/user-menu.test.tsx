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
  const utils = render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <UserMenu />
    </NextIntlClientProvider>,
  );
  await utils.user.click(screen.getByRole('button'));
  return utils;
}

describe('UserMenu', () => {
  it('shows the email in the dropdown header', async () => {
    await openMenu();
    expect(await screen.findByText('b@example.com')).toBeInTheDocument();
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
