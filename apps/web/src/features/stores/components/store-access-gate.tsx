'use client';

import { CAPABILITIES } from '@pazarsync/utils';
import type { ReactElement, ReactNode } from 'react';

import { useCurrentScope } from '@/providers/current-scope';

import { NoStoreAccessState } from './no-store-access-state';

/**
 * Renders dashboard content only when the caller can actually use it.
 *
 * A MEMBER/VIEWER who cannot connect stores AND holds zero store grants sees
 * the "ask an admin for access" state instead of empty dashboards. OWNER/ADMIN
 * — who can connect stores — always pass through to the normal connect-a-store
 * empty states. This is the frontend half of the store-access panel gate; the
 * backend already returns 404 for any store they cannot reach.
 */
export function StoreAccessGate({ children }: { children: ReactNode }): ReactElement {
  const { accessibleStores, can } = useCurrentScope();

  if (!can(CAPABILITIES.STORES_CONNECT) && accessibleStores.length === 0) {
    return <NoStoreAccessState />;
  }

  return <>{children}</>;
}
