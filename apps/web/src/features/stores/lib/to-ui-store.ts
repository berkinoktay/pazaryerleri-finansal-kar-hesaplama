import type { Store as SwitcherStore, SyncState } from '@/components/patterns/org-store-switcher';

import type { Store as ApiStore } from '../api/list-stores.api';

const SYNC_STATE_FROM_STATUS: Record<ApiStore['status'], SyncState> = {
  ACTIVE: 'fresh',
  CONNECTION_ERROR: 'failed',
  DISABLED: 'stale',
};

/**
 * Backend Store → switcher's Store shape used by OrgStoreSwitcher.
 * The switcher needs id, name, platform, syncState, lastSyncedAt — a
 * subset focused on at-a-glance health rather than connection lifecycle.
 *
 * Mapping policy (provisional, refine later):
 *   - ACTIVE            → 'fresh'   (will be overlaid with lastSyncAt-derived
 *                                    'stale' when the dashboard surfaces
 *                                    age-of-data; for now ACTIVE = fresh.)
 *   - CONNECTION_ERROR  → 'failed'
 *   - DISABLED          → 'stale'   (closest semantic — store exists but
 *                                    isn't actively syncing)
 */
export function toSwitcherStore(store: ApiStore): SwitcherStore {
  return {
    id: store.id,
    name: store.name,
    platform: store.platform,
    syncState: SYNC_STATE_FROM_STATUS[store.status],
    lastSyncedAt: store.lastSyncAt,
  };
}
