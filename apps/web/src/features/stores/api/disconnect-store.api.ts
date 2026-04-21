import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export async function disconnectStore(orgId: string, storeId: string): Promise<void> {
  const { error, response } = await apiClient.DELETE('/v1/organizations/{orgId}/stores/{storeId}', {
    params: { path: { orgId, storeId } },
  });
  if (error !== undefined) throwApiError(error, response);
}
