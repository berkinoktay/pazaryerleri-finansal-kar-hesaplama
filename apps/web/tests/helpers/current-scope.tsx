/**
 * Test scope helpers: complete `Organization` / `Store` fixtures and `TestScope`, which mounts
 * the REAL `CurrentScopeProvider` for one org (with the given role) and one store (with the
 * given platform), so `useCan` and `useCurrentStore` resolve as they do in the dashboard.
 *
 * `CurrentScopeProvider` imports the router and two server actions. vitest hoists `vi.mock`
 * per test file, so this helper cannot declare the mocks for its callers: a test file that
 * uses `TestScope` must itself declare
 *
 *   vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
 *   vi.mock('@/lib/active-store-actions', () => ({ setActiveStoreIdAction: vi.fn() }));
 *   vi.mock('@/lib/active-org-actions', () => ({ setActiveOrgIdAction: vi.fn() }));
 *
 * It also needs the QueryClient and next-intl providers (`AllProviders` / `render` from
 * `./render`) above it.
 */
import * as React from 'react';

import type { Organization } from '@/features/organization/api/organizations.api';
import type { Store } from '@/features/stores/api/list-stores.api';
import { CurrentScopeProvider } from '@/providers/current-scope';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-0000000000aa';
const DEFAULT_STORE_ID = '11111111-1111-1111-1111-111111111111';
const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00.000Z';

export function makeTestOrg(role: Organization['role'], id: string = DEFAULT_ORG_ID): Organization {
  return {
    id,
    name: 'Org',
    slug: 'org',
    timezone: 'Europe/Istanbul',
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    role,
    storeCount: 1,
    lastSyncedAt: null,
    lastAccessedAt: null,
  };
}

export function makeTestStore(platform: Store['platform'], id: string = DEFAULT_STORE_ID): Store {
  return {
    id,
    name: 'Store',
    platform,
    environment: 'PRODUCTION',
    externalAccountId: id,
    status: 'ACTIVE',
    lastConnectedAt: null,
    lastSyncAt: null,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  };
}

export interface TestScopeProps {
  role?: Organization['role'];
  platform?: Store['platform'];
  orgId?: string;
  storeId?: string;
  children: React.ReactNode;
}

/** Renders `children` inside the real `CurrentScopeProvider` for one org and one store. */
export function TestScope({
  role = 'OWNER',
  platform = 'TRENDYOL',
  orgId,
  storeId,
  children,
}: TestScopeProps): React.ReactElement {
  // Memoized so a re-render keeps the provider's value (and every hook built on it) stable.
  const org = React.useMemo(() => makeTestOrg(role, orgId), [role, orgId]);
  const store = React.useMemo(() => makeTestStore(platform, storeId), [platform, storeId]);
  const accessibleStores = React.useMemo(() => [store], [store]);

  return (
    <CurrentScopeProvider org={org} store={store} accessibleStores={accessibleStores}>
      {children}
    </CurrentScopeProvider>
  );
}
