import { prisma } from '@pazarsync/db';
import type { MemberRole } from '@pazarsync/db';

import { ForbiddenError } from './errors';

/**
 * Inline org membership check used by every route handler under
 * `/v1/organizations/{orgId}/...`. Historically this would ride on
 * `orgContextMiddleware` applied via `app.use(path, ...)`, but Hono's
 * sub-app `.use()` semantics did not compose cleanly with typed
 * Variables set by parent middleware — the parent's `c.set('userId')`
 * did not always reach a path-matched sub-app `.use()` callback for
 * POST requests. Doing the check inline in each handler keeps every
 * read of `c.get('userId')` on the same Context that parent auth set.
 *
 * Returns the org id the handler should filter by. Never 404 — cross-
 * tenant access returns 403 at this boundary (SECURITY.md §3 — existence
 * non-disclosure happens at the next layer, the store-scoped lookup).
 *
 * Optional `allowedRoles` enforces role-based authorization in the same
 * query (no second round trip). Throws `ForbiddenError('Insufficient role')`
 * if the membership exists but the role is not in the list. The role-
 * mismatch detail is intentionally generic — leaking the allowed-roles
 * list would tell a member exactly which privilege escalation path to
 * pursue. Use for destructive or sensitive actions (store connect/disconnect,
 * billing changes, member invitations, etc).
 */
export interface EnsureOrgMemberOptions {
  allowedRoles?: readonly MemberRole[];
}

export async function ensureOrgMember(
  userId: string,
  orgIdFromPath: string,
  options: EnsureOrgMemberOptions = {},
): Promise<string> {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgIdFromPath, userId } },
    select: { role: true },
  });
  if (membership === null) {
    throw new ForbiddenError('Not a member of this organization');
  }
  const { allowedRoles } = options;
  if (allowedRoles !== undefined && !allowedRoles.includes(membership.role)) {
    throw new ForbiddenError('Insufficient role');
  }
  return orgIdFromPath;
}
