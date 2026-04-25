import type { Store as UiStore } from '@/components/layout/store-switcher';

import type { Store as ApiStore } from '../api/list-stores.api';

const STATUS_MAP: Record<ApiStore['status'], UiStore['status']> = {
  ACTIVE: 'active',
  CONNECTION_ERROR: 'error',
  DISABLED: 'paused',
};

/**
 * Backend Store → UI Store. Backend carries marketplace metadata we
 * don't need in the rail (environment, lastSyncAt, externalAccountId);
 * the switcher only needs id, name, platform, status. Mapper keeps the
 * UI tipi small without coupling rail components to the OpenAPI shape.
 */
export function toUiStore(store: ApiStore): UiStore {
  return {
    id: store.id,
    name: store.name,
    platform: store.platform,
    status: STATUS_MAP[store.status],
  };
}
