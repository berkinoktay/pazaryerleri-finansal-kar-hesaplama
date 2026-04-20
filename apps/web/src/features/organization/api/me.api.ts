import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';

export type Me = components['schemas']['MeResponse'];

/**
 * GET /v1/me — the authenticated user's profile. Returns timezone +
 * preferred language so the UI can localise timestamps. Never 404s
 * for an authenticated user (backend upserts defensively).
 */
export async function getMe(): Promise<Me> {
  const { data, error } = await apiClient.GET('/v1/me', {});
  if (error) {
    throw new Error(`Failed to fetch profile: ${JSON.stringify(error)}`);
  }
  return data;
}
