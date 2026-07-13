'use client';

import * as React from 'react';

import type { Store, SwitcherPreviewStores } from '@/components/patterns/org-store-switcher';

import { toSwitcherStore } from '../lib/to-ui-store';

import { useStores } from './use-stores';

/**
 * Feature-owned adapter injected into the shared OrgStoreSwitcher pattern, so
 * the pattern layer never imports feature internals (layering rule). Fetches a
 * non-active org's stores (silently — the panel renders its own inline error)
 * and maps them to the switcher's slim Store shape.
 */
export function useSwitcherPreviewStores(orgId: string | null): SwitcherPreviewStores {
  const query = useStores(orgId, { silent: true });
  const stores = React.useMemo<Store[]>(
    () => (query.data ?? []).map(toSwitcherStore),
    [query.data],
  );
  return { stores, isLoading: query.isLoading, isError: query.isError };
}
