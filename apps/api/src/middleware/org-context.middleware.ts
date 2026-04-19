import { prisma } from '@pazarsync/db';
import { createMiddleware } from 'hono/factory';

import { ForbiddenError } from '../lib/errors';

type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

/**
 * Reads `:orgId` from the request path, verifies the authenticated user
 * has an OrganizationMember row for that org, and sets organizationId +
 * memberRole on the context.
 *
 * Returns 403 FORBIDDEN for both "not a member" and "org does not exist"
 * — intentionally not distinguishing. Leaking "this org exists" would
 * tell an attacker whether an org id is valid even when they can't
 * access it. See docs/SECURITY.md for the full rationale.
 *
 * Requires `authMiddleware` upstream (sets `userId`).
 */
export const orgContextMiddleware = createMiddleware<{
  Variables: {
    userId: string;
    organizationId: string;
    memberRole: MemberRole;
  };
}>(async (c, next) => {
  const orgId = c.req.param('orgId');
  if (orgId === undefined || orgId.length === 0) {
    throw new ForbiddenError('Organization id is required');
  }
  const userId = c.get('userId');

  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    select: { role: true },
  });

  if (membership === null) {
    throw new ForbiddenError('Not a member of this organization');
  }

  c.set('organizationId', orgId);
  c.set('memberRole', membership.role);
  await next();
});
