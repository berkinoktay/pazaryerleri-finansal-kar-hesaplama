import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type SyncLog = components['schemas']['SyncLogResponse'];
export type SyncLogListResponse = components['schemas']['SyncLogListResponse'];

export async function listActiveSyncLogs(orgId: string, storeId: string): Promise<SyncLog[]> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/sync-logs',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
