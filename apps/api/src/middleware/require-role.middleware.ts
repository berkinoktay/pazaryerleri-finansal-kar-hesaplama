import type { MemberRole } from '@pazarsync/db';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import { ForbiddenError } from '../lib/errors';

/**
 * Role-based authorization on top of orgContextMiddleware.
 *
 * Two usage shapes for the same check:
 *   - Inline in a route handler: `assertRole(c, 'OWNER', 'ADMIN')`
 *   - As a mounted middleware:   `app.use('*', requireRole('OWNER', 'ADMIN'))`
 *
 * Sub-apps built with `createSubApp()` use the inline form — mirrors the
 * existing `ensureOrgMember()` pattern. Hono's `app.use()` on a sub-app
 * does not reliably propagate parent-set `Variables` for every method
 * (see `apps/api/src/lib/ensure-org-member.ts` for the historical note).
 *
 * Requires `orgContextMiddleware` (or equivalent) upstream — it sets
 * `c.get('memberRole')`. Missing role on context is treated as a
 * configuration bug (500), not a forbidden response: hiding an
 * ordering bug behind a 403 would mask the real failure.
 */

export function assertRole(c: Context, ...allowedRoles: MemberRole[]): void {
  const raw: unknown = c.get('memberRole');
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(
      'memberRole missing on context — assertRole requires orgContext (or ensureOrgMember + manual set) upstream',
    );
  }
  if (!allowedRoles.some((allowed) => allowed === raw)) {
    throw new ForbiddenError('Insufficient role');
  }
}

export function requireRole(
  ...allowedRoles: MemberRole[]
): ReturnType<typeof createMiddleware<{ Variables: { memberRole: MemberRole } }>> {
  return createMiddleware<{ Variables: { memberRole: MemberRole } }>(async (c, next) => {
    assertRole(c, ...allowedRoles);
    await next();
  });
}
