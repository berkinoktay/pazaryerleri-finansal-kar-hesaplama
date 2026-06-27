import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type Preferences = components['schemas']['Preferences'];

/**
 * Fetch the authenticated user's stored preferences.
 * Returns the raw Preferences object (marginColoring is optional).
 */
export async function getMyPreferences(): Promise<Preferences> {
  const { data, error, response } = await apiClient.GET('/v1/me/preferences', {});
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}

/**
 * Patch the authenticated user's preferences. Only the keys present in `body`
 * are changed — the backend performs a shallow merge.
 */
export async function updateMyPreferences(body: Preferences): Promise<Preferences> {
  const { data, error, response } = await apiClient.PATCH('/v1/me/preferences', { body });
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
