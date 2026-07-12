import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type SyncLog = components['schemas']['SyncLogResponse'];
export type SyncFreshness = components['schemas']['SyncFreshness'];

/**
 * The org-syncs endpoint's two feeds. `logs` is the active + recent-N cap
 * that drives the SyncCenter progress rows; `freshness` is the per
 * (store, syncType) last-successful-run, computed independently of that
 * cap so a page can still show "last synced" for a type whose success has
 * aged out of the recent list.
 */
export interface OrgSyncsResponse {
  logs: SyncLog[];
  freshness: SyncFreshness[];
}

/**
 * Fetch active + recent sync logs plus per-type freshness across the
 * organization. Used by OrgSyncsProvider to seed the cache on mount and
 * as the polling fallback when a Realtime channel goes quiet.
 */
export async function listOrgSyncLogs(orgId: string): Promise<OrgSyncsResponse> {
  const { data, error, response } = await apiClient.GET('/v1/organizations/{orgId}/sync-logs', {
    params: { path: { orgId } },
  });
  if (error !== undefined) throwApiError(error, response);
  return { logs: data.data, freshness: data.freshness };
}
