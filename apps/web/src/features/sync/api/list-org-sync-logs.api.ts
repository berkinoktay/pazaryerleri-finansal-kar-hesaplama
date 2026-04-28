import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type SyncLog = components['schemas']['SyncLogResponse'];

/**
 * Fetch active + recent sync logs across the organization. Used by
 * OrgSyncsProvider to seed the cache on mount and as the polling
 * fallback when a Realtime channel goes quiet.
 */
export async function listOrgSyncLogs(orgId: string): Promise<SyncLog[]> {
  const { data, error, response } = await apiClient.GET('/v1/organizations/{orgId}/sync-logs', {
    params: { path: { orgId } },
  });
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
