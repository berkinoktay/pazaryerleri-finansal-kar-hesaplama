import { CAPABILITIES } from '@pazarsync/utils';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Organization } from '@/features/organization/api/organizations.api';
import type { Store } from '@/features/stores/api/list-stores.api';
import {
  CurrentScopeProvider,
  useCan,
  useCurrentScope,
  useCurrentStore,
} from '@/providers/current-scope';

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
    storeCount: 1,
    lastSyncedAt: null,
    lastAccessedAt: null,
  };
}

const STORE: Store = {
  id: 'store-1',
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

function wrapperFor(role: Organization['role']) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <CurrentScopeProvider org={makeOrg(role)} store={STORE} accessibleStores={[STORE]}>
        {children}
      </CurrentScopeProvider>
    );
  };
}

describe('useCan', () => {
  it('grants a MEMBER data:read but not stores:connect', () => {
    const wrapper = wrapperFor('MEMBER');
    expect(renderHook(() => useCan(CAPABILITIES.DATA_READ), { wrapper }).result.current).toBe(true);
    expect(renderHook(() => useCan(CAPABILITIES.STORES_CONNECT), { wrapper }).result.current).toBe(
      false,
    );
  });

  it('grants an OWNER stores:connect', () => {
    const wrapper = wrapperFor('OWNER');
    expect(renderHook(() => useCan(CAPABILITIES.STORES_CONNECT), { wrapper }).result.current).toBe(
      true,
    );
  });
});

describe('useCurrentStore', () => {
  it('exposes the active store', () => {
    const { result } = renderHook(() => useCurrentStore(), { wrapper: wrapperFor('MEMBER') });
    expect(result.current?.id).toBe('store-1');
  });
});

describe('useCurrentScope', () => {
  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useCurrentScope())).toThrow(/CurrentScopeProvider/);
  });
});
