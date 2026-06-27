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
  usePathname: () => '/settings/profile',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { SettingsNav } from '@/app/[locale]/(dashboard)/settings/settings-nav';
import { SETTINGS_NAV_SECTIONS } from '@/app/[locale]/(dashboard)/settings/settings-nav-config';
import { render, screen } from '@/../tests/helpers/render';

const DRAFT_COUNT = SETTINGS_NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.status)).filter(
  (status) => status === 'draft',
).length;

describe('SettingsNav', () => {
  it('renders the three ownership-scope groups', () => {
    render(<SettingsNav />);
    expect(screen.getByText('Hesabım')).toBeInTheDocument();
    expect(screen.getByText('Organizasyon')).toBeInTheDocument();
    expect(screen.getByText('Mağaza')).toBeInTheDocument();
  });

  it('shows a developer draft marker on every not-yet-wired item, none on wired ones', () => {
    render(<SettingsNav />);
    // Wired pages (Üyeler, Kargo) carry no marker; every draft page does.
    expect(screen.getAllByLabelText('Taslak')).toHaveLength(DRAFT_COUNT);
  });

  it('exposes a mobile section selector', () => {
    render(<SettingsNav />);
    expect(screen.getByLabelText('Ayarlar bölümü')).toBeInTheDocument();
  });
});
