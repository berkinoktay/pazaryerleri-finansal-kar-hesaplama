import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

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
import { useSwitcherPreviewStores } from '@/features/stores/hooks/use-switcher-preview-stores';
import { render, screen, waitFor } from '@/../tests/helpers/render';
import { http, HttpResponse, server } from '@/../tests/helpers/msw';

// The render helper wraps in NextIntl (the real tr.json catalog), TooltipProvider,
// and a QueryClient — everything the two-pane panel needs (its preview query for
// a non-active org is disabled here since we only exercise the active org).

// The api-client's baseUrl fallback when NEXT_PUBLIC_API_URL is unset (mirrors
// tests/helpers/msw.ts). The panel's cross-org preview fetches from here.
const TEST_API_BASE = 'http://localhost:3001';

// A full backend Store payload (the switcher only reads id/name/platform via
// toSwitcherStore, but MSW must serve the whole shape the API returns).
function apiStore(store: { id: string; name: string; platform?: Store['platform'] }) {
  return {
    id: store.id,
    name: store.name,
    platform: store.platform ?? 'TRENDYOL',
    environment: 'PRODUCTION',
    externalAccountId: '99999',
    status: 'ACTIVE',
    lastConnectedAt: null,
    lastSyncAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

// Register the org-b store list for the cross-org preview query. `data` is the
// list envelope items; pass `[]` for the "org has no stores yet" branch.
function serveOrgBStores(data: ReturnType<typeof apiStore>[]): void {
  server.use(
    http.get(`${TEST_API_BASE}/v1/organizations/org-b/stores`, () => HttpResponse.json({ data })),
  );
}

const mockOrgs: Organization[] = [
  { id: 'org-a', name: 'Acme A.Ş.', role: 'OWNER' },
  { id: 'org-b', name: 'Beta Ltd', role: 'ADMIN' },
];

const mockStores: Store[] = [
  { id: 'store-1', name: 'Trendyol Acme TR', platform: 'TRENDYOL' },
  { id: 'store-2', name: 'Hepsiburada Acme', platform: 'HEPSIBURADA' },
];

interface RenderProps {
  orgs?: Organization[];
  stores?: Store[];
  activeOrgId?: string | null;
  activeStoreId?: string | null;
  collapsed?: boolean;
  onSelectOrg?: (id: string) => void;
  onSelectStore?: (id: string) => void;
  onSelectScope?: (orgId: string, storeId: string, storeName: string) => void;
  onAddStore?: () => void;
}

function renderSwitcher(props: RenderProps = {}) {
  const onSelectOrg = props.onSelectOrg ?? vi.fn();
  const onSelectStore = props.onSelectStore ?? vi.fn();
  const onSelectScope = props.onSelectScope ?? vi.fn();
  const utils = render(
    <OrgStoreSwitcher
      orgs={props.orgs ?? mockOrgs}
      stores={props.stores ?? mockStores}
      activeOrgId={props.activeOrgId === undefined ? 'org-a' : props.activeOrgId}
      activeStoreId={props.activeStoreId === undefined ? 'store-1' : props.activeStoreId}
      onSelectOrg={onSelectOrg}
      onSelectStore={onSelectStore}
      onSelectScope={onSelectScope}
      onAddStore={props.onAddStore}
      usePreviewStores={useSwitcherPreviewStores}
      collapsed={props.collapsed}
    />,
  );
  return { ...utils, onSelectOrg, onSelectStore, onSelectScope };
}

describe('OrgStoreSwitcher', () => {
  it('renders the active store name and its org name in the expanded chip', () => {
    renderSwitcher();
    // Store-first trigger: line 1 = active store, line 2 = its org.
    expect(screen.getByText('Trendyol Acme TR')).toBeInTheDocument();
    expect(screen.getByText('Acme A.Ş.')).toBeInTheDocument();
  });

  it('opens the two-pane panel with the org list when the trigger is clicked', async () => {
    const { user } = renderSwitcher();
    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));
    // "Beta Ltd" only lives in the panel's org list, never in the trigger.
    expect(await screen.findByText('Beta Ltd')).toBeInTheDocument();
  });

  it('calls onSelectStore when a different store in the active org is picked', async () => {
    const { user, onSelectStore } = renderSwitcher();
    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));
    await user.click(await screen.findByText('Hepsiburada Acme'));
    expect(onSelectStore).toHaveBeenCalledWith('store-2');
  });

  it('runs onAddStore from the Stores header when provided', async () => {
    const onAddStore = vi.fn();
    const { user } = renderSwitcher({ onAddStore });
    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));
    // With onAddStore wired, the "+ Yeni Mağaza" create action is a button
    // (opens the connect-store modal) instead of a settings-page link.
    await user.click(await screen.findByRole('button', { name: '+ Yeni Mağaza' }));
    expect(onAddStore).toHaveBeenCalledTimes(1);
  });

  it('shows a role badge for each organization in the panel', async () => {
    const { user } = renderSwitcher();
    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));
    // Turkish role labels from common.roles: OWNER → "Sahip", ADMIN → "Yönetici".
    // Matched on ASCII-safe substrings so the assertions carry no Turkish bytes.
    expect(await screen.findByText(/sahip/i)).toBeInTheDocument();
    expect(screen.getByText(/netici/i)).toBeInTheDocument();
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
    // so we match the dropdown CTA specifically by its link role.
    expect(
      await screen.findByRole('link', { name: /yeni organizasyon oluştur/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /davet kodum var/i })).toBeInTheDocument();
  });

  it('hides the text lines when collapsed=true and still renders a trigger button', () => {
    renderSwitcher({ collapsed: true });
    expect(screen.queryByText('Acme A.Ş.')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('previews a cross-org row without committing — fetches its stores, no onSelectOrg', async () => {
    serveOrgBStores([apiStore({ id: 'store-b1', name: 'Beta Trendyol' })]);
    const { user, onSelectOrg } = renderSwitcher();

    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));
    await user.click(await screen.findByText('Beta Ltd'));

    // Clicking an org row only PREVIEWS: org-b's stores load into the right pane,
    // the panel stays open, and no scope switch has fired yet.
    expect(await screen.findByText('Beta Trendyol')).toBeInTheDocument();
    expect(screen.getByText('Organizasyonlar')).toBeInTheDocument();
    expect(onSelectOrg).not.toHaveBeenCalled();
  });

  it('commits a cross-org store pick via onSelectScope and closes the panel', async () => {
    serveOrgBStores([apiStore({ id: 'store-b1', name: 'Beta Trendyol' })]);
    const { user, onSelectScope, onSelectStore } = renderSwitcher();

    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));
    await user.click(await screen.findByText('Beta Ltd'));
    await user.click(await screen.findByText('Beta Trendyol'));

    // Picking a previewed non-active org's store jumps org + store in one step.
    expect(onSelectScope).toHaveBeenCalledWith('org-b', 'store-b1', 'Beta Trendyol');
    expect(onSelectStore).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Organizasyonlar')).not.toBeInTheDocument());
  });

  it('commits a same-org store pick via onSelectStore, never onSelectScope', async () => {
    const { user, onSelectStore, onSelectScope } = renderSwitcher();

    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));
    // store-2 is the non-active store of the already-active org-a.
    await user.click(await screen.findByText('Hepsiburada Acme'));

    expect(onSelectStore).toHaveBeenCalledWith('store-2');
    expect(onSelectScope).not.toHaveBeenCalled();
  });

  it('renders the org pane even when there is a single organization', async () => {
    const singleOrg: Organization[] = [{ id: 'org-a', name: 'Acme A.Ş.', role: 'OWNER' }];
    const { user } = renderSwitcher({ orgs: singleOrg });

    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));

    // Single org still renders the two-pane layout: the org pane keeps its
    // heading and the single org row (proven by its OWNER role badge, which
    // only the org pane renders) alongside the store pane's counted heading.
    expect(await screen.findByText('Organizasyonlar')).toBeInTheDocument();
    expect(screen.getByText('Mağazalar (2)')).toBeInTheDocument();
    // OWNER role badge renders "Sahip" (common.roles) — matched ASCII-safe.
    expect(screen.getByText(/sahip/i)).toBeInTheDocument();
  });

  it('offers an org-only switch when the previewed org has zero stores', async () => {
    serveOrgBStores([]);
    const { user, onSelectOrg } = renderSwitcher();

    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));
    await user.click(await screen.findByText('Beta Ltd'));

    expect(await screen.findByText('Bu organizasyonda henüz mağaza yok')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Bu organizasyona geç' }));

    expect(onSelectOrg).toHaveBeenCalledWith('org-b');
    await waitFor(() => expect(screen.queryByText('Organizasyonlar')).not.toBeInTheDocument());
  });

  it('opens a dialog shell (not a popover) when the rail is collapsed', async () => {
    const { user } = renderSwitcher({ collapsed: true });

    await user.click(screen.getByRole('button'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Organizasyon ve mağaza değiştir');
  });

  it('shows the quiet error row when the previewed org store fetch fails', async () => {
    server.use(
      http.get(`${TEST_API_BASE}/v1/organizations/org-b/stores`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Internal Server Error',
            status: 500,
            code: 'INTERNAL_ERROR',
            detail: 'boom',
          },
          { status: 500 },
        ),
      ),
    );
    const { user } = renderSwitcher();

    await user.click(screen.getByRole('button', { name: /Acme A\.Ş\./ }));
    await user.click(await screen.findByText('Beta Ltd'));

    expect(await screen.findByText('Mağazalar yüklenemedi')).toBeInTheDocument();
  });
});
