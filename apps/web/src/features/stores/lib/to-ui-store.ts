import type { Store as SwitcherStore } from '@/components/patterns/org-store-switcher';

import type { Store as ApiStore } from '../api/list-stores.api';

/**
 * Backend Store → switcher's Store shape used by OrgStoreSwitcher.
 * The switcher consumes only identity fields — id, name, platform — since
 * the store-first card + two-pane panel is a pure org/store picker. Sync
 * health surfaces live in the sync feature (see #469), not in the switcher.
 */
export function toSwitcherStore(store: ApiStore): SwitcherStore {
  return {
    id: store.id,
    name: store.name,
    platform: store.platform,
  };
}
