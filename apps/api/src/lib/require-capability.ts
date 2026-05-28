import type { MemberRole } from '@pazarsync/db';
import { can, type Capability } from '@pazarsync/utils';

import { ForbiddenError } from './errors';
import { getMembershipRole } from './org-member-lookup';

/**
 * Membership + capability check for a route handler. The capability-aware
 * sibling of `ensureOrgMember`: looks up the caller's role in the org, then
 * gates on a fine-grained capability derived from that role (see
 * `ROLE_CAPABILITIES` in @pazarsync/utils).
 *
 * Throws `ForbiddenError` if the caller is not a member, or if their role
 * lacks the capability. The detail is intentionally generic — leaking which
 * capability was missing would map out the privilege-escalation surface.
 *
 * Returns the caller's role so the handler can branch further without a
 * second lookup (e.g. pass it on, or skip work OWNER/ADMIN don't need).
 *
 * Prefer this over `ensureOrgMember(..., { allowedRoles })`: role lists
 * scattered across routes drift; a capability names the intent once and the
 * role→capability map stays the single source of truth.
 */
export async function requireCapability(
  userId: string,
  organizationId: string,
  capability: Capability,
): Promise<MemberRole> {
  const role = await getMembershipRole(userId, organizationId);
  if (role === null) {
    throw new ForbiddenError('Not a member of this organization');
  }
  if (!can(role, capability)) {
    throw new ForbiddenError('Insufficient capability');
  }
  return role;
}

/**
 * Pure capability assertion when the role is already in hand (e.g. returned by
 * `requireStoreAccess`). Throws `ForbiddenError` if the role lacks the
 * capability. Use to layer a write/sync gate on top of a store-access read
 * gate without a second membership lookup.
 */
export function assertCapability(role: MemberRole, capability: Capability): void {
  if (!can(role, capability)) {
    throw new ForbiddenError('Insufficient capability');
  }
}
