import { prisma } from '@pazarsync/db';
import type { MemberRole } from '@pazarsync/db';

import { CostProfileNotFoundError } from './errors';
import { ForbiddenError } from './errors';
import { getMembershipRole } from './org-member-lookup';

/**
 * Store-access gate for a single cost profile, addressed by id.
 *
 * Cost profiles are store-scoped: each belongs to exactly one store. A
 * MEMBER/VIEWER may only touch profiles that live in a store they've been
 * granted (member_store_access). OWNER/ADMIN see every store in their org by
 * role and skip the grant check.
 *
 * `role` is passed in so a caller that already resolved it (e.g. via
 * `requireCapability`) doesn't pay a second membership lookup.
 *
 * Non-disclosure (SECURITY.md §3): a profile in an ungranted store is
 * indistinguishable from one that doesn't exist — both raise
 * `CostProfileNotFoundError` (404). The backend runs as the postgres role and
 * bypasses RLS, so this is the API-layer enforcement — the counterpart to
 * `can_access_store()` for the by-id cost-profile routes.
 */
export async function assertProfileStoreAccess(
  userId: string,
  organizationId: string,
  profileId: string,
  role: MemberRole,
): Promise<void> {
  if (role === 'OWNER' || role === 'ADMIN') {
    return;
  }

  const profile = await prisma.costProfile.findFirst({
    where: { id: profileId, organizationId },
    select: { storeId: true },
  });
  if (profile === null) {
    throw new CostProfileNotFoundError(profileId);
  }

  const grant = await prisma.memberStoreAccess.findFirst({
    where: { storeId: profile.storeId, member: { organizationId, userId } },
    select: { id: true },
  });
  if (grant === null) {
    throw new CostProfileNotFoundError(profileId);
  }
}

/**
 * Membership + store-access gate for a by-id cost-profile READ route.
 *
 * Throws `ForbiddenError` (403) for a non-member, then applies
 * `assertProfileStoreAccess` (404 for an ungranted-store or missing profile).
 * Returns the caller's role so a handler can branch without a second lookup.
 */
export async function requireCostProfileStoreAccess(
  userId: string,
  organizationId: string,
  profileId: string,
): Promise<MemberRole> {
  const role = await getMembershipRole(userId, organizationId);
  if (role === null) {
    throw new ForbiddenError('Not a member of this organization');
  }
  await assertProfileStoreAccess(userId, organizationId, profileId, role);
  return role;
}
