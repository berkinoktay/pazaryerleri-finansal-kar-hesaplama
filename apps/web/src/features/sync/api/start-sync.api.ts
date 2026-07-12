import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type StartSyncResponse = components['schemas']['StartSyncResponse'];

/**
 * The user-triggerable sync surfaces. Mirrors the backend's TriggerSyncBody
 * enum — ORDERS / PRODUCTS / SETTLEMENTS / CLAIMS (PRODUCTS_DELTA is
 * cron-internal and rejected by the endpoint).
 */
export type TriggerSyncType = components['schemas']['TriggerSyncBody']['syncType'];

/**
 * Enqueue a manual marketplace sync of any triggerable type. Returns the new
 * SyncLog id immediately (the worker claims the PENDING row and runs the sync
 * in the background). Same 202 / 409 / 429 contract for every triggerable
 * syncType.
 */
export async function startSync(
  orgId: string,
  storeId: string,
  syncType: TriggerSyncType,
): Promise<StartSyncResponse> {
  const { data, error, response } = await apiClient.POST(
    '/v1/organizations/{orgId}/stores/{storeId}/syncs',
    { params: { path: { orgId, storeId } }, body: { syncType } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
