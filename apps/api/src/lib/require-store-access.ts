import { prisma } from '@pazarsync/db';
import type { MemberRole, Store as PrismaStore } from '@pazarsync/db';

import { ForbiddenError, NotFoundError } from './errors';
import { getMembershipRole } from './org-member-lookup';

/**
 * Membership + store-access check for store-scoped route handlers
 * (`/v1/organizations/{orgId}/stores/{storeId}/...`).
 *
 * Three gates, in order:
 *   1. Caller must be a member of the org → else 403 (same boundary as
 *      ensureOrgMember).
 *   2. The store must belong to the org → else 404 (existence non-disclosure,
 *      SECURITY.md §3).
 *   3. For MEMBER/VIEWER, a member_store_access grant for this store must
 *      exist → else 404 (same non-disclosure: an ungranted store is
 *      indistinguishable from a missing one). OWNER/ADMIN see every store in
 *      their org by role and skip the grant check.
 *
 * This is the API-layer counterpart to the can_access_store() RLS helper:
 * Prisma runs as the postgres role and bypasses RLS, so the API must enforce
 * store access itself. Returns the full Prisma store row (callers needing the
 * public wire shape strip credentials via toStoreResponse) plus the caller's
 * role, so a handler can branch without a second lookup.
 */
export async function requireStoreAccess(
  userId: string,
  organizationId: string,
  storeId: string,
): Promise<{ store: PrismaStore; role: MemberRole }> {
  const role = await getMembershipRole(userId, organizationId);
  if (role === null) {
    throw new ForbiddenError('Not a member of this organization');
  }

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId } });
  if (store === null) {
    throw new NotFoundError('Store', storeId);
  }

  if (role === 'OWNER' || role === 'ADMIN') {
    return { store, role };
  }

  const grant = await prisma.memberStoreAccess.findFirst({
    where: { storeId, member: { organizationId, userId } },
    select: { id: true },
  });
  if (grant === null) {
    throw new NotFoundError('Store', storeId);
  }
  return { store, role };
}

/**
 * The store ids a caller may see within an org. Returns `null` for OWNER/ADMIN
 * — they see every store, so callers should apply no store filter. For
 * MEMBER/VIEWER returns the granted store ids (possibly empty → sees nothing).
 *
 * Used to narrow org-wide list endpoints (e.g. the org sync-log feed) to the
 * caller's accessible stores, and to populate `accessibleStoreIds` on the
 * membership-context response.
 */
export async function accessibleStoreIds(
  userId: string,
  organizationId: string,
  role: MemberRole,
): Promise<string[] | null> {
  if (role === 'OWNER' || role === 'ADMIN') {
    return null;
  }
  const grants = await prisma.memberStoreAccess.findMany({
    where: { organizationId, member: { userId } },
    select: { storeId: true },
  });
  return grants.map((g) => g.storeId);
}
