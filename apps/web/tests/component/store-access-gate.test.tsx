import { describe, expect, it, vi } from 'vitest';

import type { Organization } from '@/features/organization/api/organizations.api';
import type { Store } from '@/features/stores/api/list-stores.api';
import { StoreAccessGate } from '@/features/stores/components/store-access-gate';
import { CurrentScopeProvider } from '@/providers/current-scope';

import { render, screen } from '../helpers/render';

// The provider reads useRouter at mount and the cookie server actions on switch.
// Neither matters for gate rendering — stub them so the module loads in happy-dom.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/active-store-actions', () => ({ setActiveStoreIdAction: vi.fn() }));
vi.mock('@/lib/active-org-actions', () => ({ setActiveOrgIdAction: vi.fn() }));

function makeOrg(role: Organization['role']): Organization {
  return {
    id: 'org-1',
    name: 'Org',
    slug: 'org',
    currency: 'TRY',
    timezone: 'Europe/Istanbul',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    role,
    storeCount: 0,
    lastSyncedAt: null,
    lastAccessedAt: null,
  };
}

function makeStore(id: string): Store {
  return {
    id,
    name: 'Store',
    platform: 'TRENDYOL',
    environment: 'PRODUCTION',
    externalAccountId: 'acc-1',
    status: 'ACTIVE',
    lastConnectedAt: null,
    lastSyncAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderGate(role: Organization['role'], stores: Store[]): void {
  render(
    <CurrentScopeProvider org={makeOrg(role)} store={stores[0] ?? null} accessibleStores={stores}>
      <StoreAccessGate>
        <div>panel content</div>
      </StoreAccessGate>
    </CurrentScopeProvider>,
  );
}

describe('StoreAccessGate', () => {
  it('shows the no-access state for a MEMBER with no store grants', () => {
    renderGate('MEMBER', []);
    expect(screen.getByText('Henüz mağaza erişimin yok')).toBeInTheDocument();
    expect(screen.queryByText('panel content')).not.toBeInTheDocument();
  });

  it('shows the no-access state for a VIEWER with no store grants', () => {
    renderGate('VIEWER', []);
    expect(screen.getByText('Henüz mağaza erişimin yok')).toBeInTheDocument();
  });

  it('renders content for a MEMBER who has a granted store', () => {
    renderGate('MEMBER', [makeStore('s1')]);
    expect(screen.getByText('panel content')).toBeInTheDocument();
  });

  it('renders content for an OWNER even with no stores (they can connect one)', () => {
    renderGate('OWNER', []);
    expect(screen.getByText('panel content')).toBeInTheDocument();
  });
});
