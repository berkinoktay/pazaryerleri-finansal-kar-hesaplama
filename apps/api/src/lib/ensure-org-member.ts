import { prisma } from '@pazarsync/db';

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
 */
export async function ensureOrgMember(userId: string, orgIdFromPath: string): Promise<string> {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgIdFromPath, userId } },
    select: { role: true },
  });
  if (membership === null) {
    throw new ForbiddenError('Not a member of this organization');
  }
  return orgIdFromPath;
}
