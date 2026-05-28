import { prisma } from '@pazarsync/db';
import type { MemberRole } from '@pazarsync/db';
import { capabilitiesFor } from '@pazarsync/utils';

import { InvalidReferenceError, NotFoundError, ValidationError } from '../lib/errors';
import { accessibleStoreIds } from '../lib/require-store-access';
import type { Member, MembershipContext } from '../validators/member.validator';

const memberInclude = {
  user: { select: { email: true, fullName: true } },
  storeAccess: { select: { storeId: true } },
} as const;

interface MemberRow {
  id: string;
  userId: string;
  role: MemberRole;
  user: { email: string; fullName: string | null };
  storeAccess: { storeId: string }[];
}

function toMember(m: MemberRow): Member {
  return {
    id: m.id,
    userId: m.userId,
    email: m.user.email,
    fullName: m.user.fullName,
    role: m.role,
    // OWNER/ADMIN see every store by role → `null` ("all"), so the UI never
    // renders a per-store grant editor for them. MEMBER/VIEWER expose their
    // explicit grant set.
    accessibleStoreIds:
      m.role === 'OWNER' || m.role === 'ADMIN' ? null : m.storeAccess.map((g) => g.storeId),
  };
}

/** The org's roster, oldest membership first. Caller must hold `members:read`. */
export async function listMembers(organizationId: string): Promise<Member[]> {
  const rows = await prisma.organizationMember.findMany({
    where: { organizationId },
    include: memberInclude,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toMember);
}

/**
 * Change a member's role. Caller must hold `members:manage_roles` (OWNER).
 *
 * Last-owner guard: an org must always keep ≥1 OWNER — otherwise no one could
 * manage roles or delete it. Demoting the only OWNER is rejected with a
 * field-level `CANNOT_DEMOTE_LAST_OWNER` so the management form can show a
 * precise message.
 */
export async function updateMemberRole(
  organizationId: string,
  memberId: string,
  role: MemberRole,
): Promise<Member> {
  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true, role: true },
  });
  if (member === null) {
    throw new NotFoundError('Member', memberId);
  }

  if (member.role === 'OWNER' && role !== 'OWNER') {
    const ownerCount = await prisma.organizationMember.count({
      where: { organizationId, role: 'OWNER' },
    });
    if (ownerCount <= 1) {
      throw new ValidationError([{ field: 'role', code: 'CANNOT_DEMOTE_LAST_OWNER' }]);
    }
  }

  const updated = await prisma.organizationMember.update({
    where: { id: memberId },
    data: { role },
    include: memberInclude,
  });
  return toMember(updated);
}

/**
 * Replace a member's store-access grant set with exactly `storeIds` (full
 * replace, not a delta). Caller must hold `members:manage_access`. Every id
 * must belong to the org, else `INVALID_REFERENCE`. Has no visibility effect
 * for OWNER/ADMIN targets — they see all stores by role — but the rows are
 * still stored so a later demotion has a defined access set.
 */
export async function setMemberStoreAccess(
  organizationId: string,
  memberId: string,
  storeIds: string[],
): Promise<Member> {
  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true },
  });
  if (member === null) {
    throw new NotFoundError('Member', memberId);
  }

  const uniqueStoreIds = [...new Set(storeIds)];
  if (uniqueStoreIds.length > 0) {
    const inOrg = await prisma.store.count({
      where: { organizationId, id: { in: uniqueStoreIds } },
    });
    if (inOrg !== uniqueStoreIds.length) {
      throw new InvalidReferenceError('storeIds', 'one or more stores not in this organization');
    }
  }

  await prisma.$transaction([
    prisma.memberStoreAccess.deleteMany({ where: { memberId } }),
    prisma.memberStoreAccess.createMany({
      data: uniqueStoreIds.map((storeId) => ({ organizationId, memberId, storeId })),
    }),
  ]);

  const updated = await prisma.organizationMember.findFirstOrThrow({
    where: { id: memberId },
    include: memberInclude,
  });
  return toMember(updated);
}

/**
 * The caller's own membership context for an org: role, the capabilities it
 * grants, and the stores they may see. `role` is already resolved by the route
 * (via requireCapability), so this composes the derived fields without a second
 * membership lookup.
 */
export async function getMembershipContext(
  userId: string,
  organizationId: string,
  role: MemberRole,
): Promise<MembershipContext> {
  return {
    role,
    capabilities: capabilitiesFor(role),
    accessibleStoreIds: await accessibleStoreIds(userId, organizationId, role),
  };
}
