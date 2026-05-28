import { describe, expect, it, vi } from 'vitest';

import type { Member } from '@/features/members/api/members.api';
import { MembersTable } from '@/features/members/components/members-table';
import type { Organization } from '@/features/organization/api/organizations.api';
import type { Store } from '@/features/stores/api/list-stores.api';
import { CurrentScopeProvider } from '@/providers/current-scope';

import { HttpResponse, http, server } from '../helpers/msw';
import { render, screen, waitFor } from '../helpers/render';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/active-store-actions', () => ({ setActiveStoreIdAction: vi.fn() }));
vi.mock('@/lib/active-org-actions', () => ({ setActiveOrgIdAction: vi.fn() }));

const API = 'http://localhost:3001';
const ORG_ID = '00000000-0000-0000-0000-0000000000aa';

function makeOrg(role: Organization['role']): Organization {
  return {
    id: ORG_ID,
    name: 'Org',
    slug: 'org',
    currency: 'TRY',
    timezone: 'Europe/Istanbul',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    role,
    storeCount: 2,
    lastSyncedAt: null,
    lastAccessedAt: null,
  };
}

function makeStore(id: string, name: string): Store {
  return {
    id,
    name,
    platform: 'TRENDYOL',
    environment: 'PRODUCTION',
    externalAccountId: id,
    status: 'ACTIVE',
    lastConnectedAt: null,
    lastSyncAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const STORE_A = makeStore('11111111-1111-1111-1111-111111111111', 'Store A');
const STORE_B = makeStore('22222222-2222-2222-2222-222222222222', 'Store B');

const MEMBER_ROW: Member = {
  id: '33333333-3333-3333-3333-333333333333',
  userId: '44444444-4444-4444-4444-444444444444',
  email: 'member@pazarsync.local',
  fullName: 'Member User',
  role: 'MEMBER',
  accessibleStoreIds: [],
};

function renderTable(callerRole: Organization['role']): ReturnType<typeof render> {
  return render(
    <CurrentScopeProvider
      org={makeOrg(callerRole)}
      store={STORE_A}
      accessibleStores={[STORE_A, STORE_B]}
    >
      <MembersTable orgId={ORG_ID} members={[MEMBER_ROW]} stores={[STORE_A, STORE_B]} />
    </CurrentScopeProvider>,
  );
}

describe('MembersTable', () => {
  it('shows manage actions for an OWNER', () => {
    renderTable('OWNER');
    expect(screen.getByRole('button', { name: 'Rol' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mağaza erişimi' })).toBeInTheDocument();
  });

  it('hides manage actions from a MEMBER', () => {
    renderTable('MEMBER');
    expect(screen.queryByRole('button', { name: 'Rol' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mağaza erişimi' })).not.toBeInTheDocument();
  });

  it('lets an OWNER grant a store through the access dialog', async () => {
    let receivedStoreIds: string[] | null = null;
    server.use(
      http.put(
        `${API}/v1/organizations/${ORG_ID}/members/${MEMBER_ROW.id}/store-access`,
        async ({ request }) => {
          const body = (await request.json()) as { storeIds: string[] };
          receivedStoreIds = body.storeIds;
          return HttpResponse.json({ ...MEMBER_ROW, accessibleStoreIds: body.storeIds });
        },
      ),
    );

    const { user } = renderTable('OWNER');

    await user.click(screen.getByRole('button', { name: 'Mağaza erişimi' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Store B'));
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(receivedStoreIds).toEqual([STORE_B.id]);
  });
});
