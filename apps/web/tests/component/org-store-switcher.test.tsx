import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import {
  OrgStoreSwitcher,
  type Organization,
  type Store,
} from '@/components/patterns/org-store-switcher';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
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
    emptyDescription: "PazarSync'e başlamak için bir organizasyon oluştur ya da bir davete katıl.",
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
  {
    id: 'org-b',
    name: 'Beta Ltd',
    role: 'ADMIN',
    storeCount: 5,
    lastSyncedAt: '2026-04-25T11:00:00Z',
    lastAccessedAt: '2026-04-24T18:00:00Z',
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
  {
    id: 'store-2',
    name: 'Hepsiburada Acme',
    platform: 'HEPSIBURADA',
    syncState: 'stale',
    lastSyncedAt: '2026-04-25T09:00:00Z',
  },
];

interface RenderProps {
  orgs?: Organization[];
  stores?: Store[];
  activeOrgId?: string | null;
  activeStoreId?: string | null;
  collapsed?: boolean;
  onSelectOrg?: (id: string) => void;
  onSelectStore?: (id: string) => void;
}

function renderSwitcher(props: RenderProps = {}) {
  const onSelectOrg = props.onSelectOrg ?? vi.fn();
  const onSelectStore = props.onSelectStore ?? vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <OrgStoreSwitcher
        orgs={props.orgs ?? mockOrgs}
        stores={props.stores ?? mockStores}
        activeOrgId={props.activeOrgId === undefined ? 'org-a' : props.activeOrgId}
        activeStoreId={props.activeStoreId === undefined ? 'store-1' : props.activeStoreId}
        onSelectOrg={onSelectOrg}
        onSelectStore={onSelectStore}
        collapsed={props.collapsed}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onSelectOrg, onSelectStore };
}

describe('OrgStoreSwitcher', () => {
  it('renders the active org and store names in the expanded chip', () => {
    renderSwitcher();
    expect(screen.getByText('Acme A.Ş.')).toBeInTheDocument();
    expect(screen.getByText('Trendyol Acme TR')).toBeInTheDocument();
  });

  it('opens the dropdown with a search input when the trigger is clicked', async () => {
    const { user } = renderSwitcher();
    const trigger = screen.getByRole('button', { name: /Acme A\.Ş\./ });
    await user.click(trigger);
    expect(await screen.findByPlaceholderText(/ara/i)).toBeInTheDocument();
  });

  it('filters dropdown rows when the user types in the search input', async () => {
    const { user } = renderSwitcher();
    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));
    const search = await screen.findByPlaceholderText(/ara/i);
    await user.type(search, 'trend');
    // Trendyol row should still be present (matches "trend"); Hepsiburada
    // row should be filtered out by cmdk's fuzzy match.  The active-store
    // name also appears in the trigger chip, so we verify Trendyol with
    // findAllByText (more than zero) and Hepsiburada via queryByText (none).
    const trendyolMatches = await screen.findAllByText('Trendyol Acme TR');
    expect(trendyolMatches.length).toBeGreaterThan(0);
    expect(screen.queryByText('Hepsiburada Acme')).not.toBeInTheDocument();
  });

  it('calls onSelectOrg with the chosen org id when an org row is clicked', async () => {
    const { user, onSelectOrg } = renderSwitcher();
    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));
    await screen.findByPlaceholderText(/ara/i);
    await user.click(screen.getByText('Beta Ltd'));
    expect(onSelectOrg).toHaveBeenCalledWith('org-b');
  });

  it('shows a role badge for each organization in the dropdown', async () => {
    const { user } = renderSwitcher();
    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));
    await screen.findByPlaceholderText(/ara/i);
    expect(screen.getByText(/owner/i)).toBeInTheDocument();
    expect(screen.getByText(/admin/i)).toBeInTheDocument();
  });

  it('renders the empty state CTA when there are no organizations', async () => {
    const { user } = renderSwitcher({
      orgs: [],
      stores: [],
      activeOrgId: null,
      activeStoreId: null,
    });
    await user.click(screen.getByRole('button'));
    // The trigger chip ALSO labels itself with `emptyCreate` ("+ Yeni…"),
    // so the same text appears twice (trigger + dropdown CTA link).  We
    // verify the dropdown CTA specifically by matching the role link.
    expect(
      await screen.findByRole('link', { name: /yeni organizasyon oluştur/i }),
    ).toBeInTheDocument();
    // Bonus: the join-invite secondary CTA is also visible.
    expect(screen.getByRole('link', { name: /davet kodum var/i })).toBeInTheDocument();
  });

  it('hides the names block when collapsed=true and still renders a trigger button', () => {
    renderSwitcher({ collapsed: true });
    expect(screen.queryByText('Acme A.Ş.')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
