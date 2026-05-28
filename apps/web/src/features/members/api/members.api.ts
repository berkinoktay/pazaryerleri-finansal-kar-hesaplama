import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type Member = components['schemas']['Member'];
export type MemberRole = Member['role'];
// Re-exported from the shared API client (not the stores feature) so members
// code stays free of a cross-feature edge.
export type Store = components['schemas']['Store'];

/**
 * Stable role → i18n sub-key (settings.members.roles.*). Typed as literals so
 * next-intl accepts it — `role.toLowerCase()` is plain `string` and is rejected
 * by the typed message keys.
 */
export const ROLE_LABEL_KEY = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const satisfies Record<MemberRole, string>;

/** The org roster. Caller must hold `members:read` (OWNER/ADMIN). */
export async function listMembers(orgId: string): Promise<Member[]> {
  const { data, error, response } = await apiClient.GET('/v1/organizations/{orgId}/members', {
    params: { path: { orgId } },
  });
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}

/** Change a member's role. Caller must hold `members:manage_roles` (OWNER). */
export async function updateMemberRole(
  orgId: string,
  memberId: string,
  role: MemberRole,
): Promise<Member> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/members/{memberId}',
    { params: { path: { orgId, memberId } }, body: { role } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}

/**
 * Replace a member's store-access grants with exactly `storeIds` (full replace).
 * Caller must hold `members:manage_access` (OWNER/ADMIN).
 */
export async function setMemberStoreAccess(
  orgId: string,
  memberId: string,
  storeIds: string[],
): Promise<Member> {
  const { data, error, response } = await apiClient.PUT(
    '/v1/organizations/{orgId}/members/{memberId}/store-access',
    { params: { path: { orgId, memberId } }, body: { storeIds } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
