import { prisma } from '@pazarsync/db';
import type { MemberRole } from '@pazarsync/db';

/**
 * Lookup helper for `(userId, orgId) → role | null` — shared between
 * `orgContextMiddleware` (which sets `c.set('memberRole', ...)`) and
 * `ensureOrgMember()` (the inline membership check used by sub-app
 * route handlers). Both did the same `findUnique` with `select: { role }`
 * — DRY'ing it keeps the query shape and indexing assumptions in one place.
 *
 * Returns `null` for "not a member". Callers decide whether that is a
 * 401 (auth chain bug), 403 (forbidden), or 404 (not found). This helper
 * intentionally does not throw — leaving HTTP semantics to the caller
 * means it stays callable from contexts that have their own error policy.
 */

export async function getMembershipRole(userId: string, orgId: string): Promise<MemberRole | null> {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}
