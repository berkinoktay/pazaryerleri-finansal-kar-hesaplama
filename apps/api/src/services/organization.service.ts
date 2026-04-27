import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { generateUniqueOrganizationSlug } from '../lib/slugify';
import type { CreateOrganizationInput } from '../validators/organization.validator';

export type OrganizationListItemRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface OrganizationListItem {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  role: OrganizationListItemRole;
  storeCount: number;
  lastSyncedAt: string | null;
  lastAccessedAt: string | null;
}

export interface OrganizationCreated {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  /** Always OWNER — the caller becomes owner of the org they just created. */
  role: 'OWNER';
  /** Always 0 — a fresh org has no stores yet. */
  storeCount: 0;
  /** Always null — no store sync has happened against a brand-new org. */
  lastSyncedAt: null;
  /** Always null — POST does not stamp `last_accessed_at`; the explicit
   * `POST /v1/organizations/{orgId}/access` call does. */
  lastAccessedAt: null;
  membership: { role: 'OWNER' };
}

/**
 * Return every organization where `userId` has an OrganizationMember row.
 *
 * Ordered by name ASC for stable, human-friendly output. The dropdown
 * applies its own "recently used" pinning client-side from `lastAccessedAt`
 * so the wire ordering stays predictable across devices.
 *
 * Each row carries four caller-scoped fields beyond the bare org:
 *   - `role` — the caller's MemberRole on this org
 *   - `lastAccessedAt` — when the caller last switched into this org
 *   - `storeCount` — total stores under the org (every status counted, so
 *     the switcher reflects the operator-visible total — a CONNECTION_ERROR
 *     store is still an attached store the user expects to see)
 *   - `lastSyncedAt` — MAX(stores.last_sync_at) across the org's stores;
 *     `null` when no store has completed a sync yet
 *
 * Implementation: one query pulls the membership join + nested stores
 * with only `lastSyncAt` selected, so the working set stays small even
 * when an org has many stores. The aggregate is computed in memory.
 */
export async function listForUser(userId: string): Promise<OrganizationListItem[]> {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    include: {
      organization: {
        include: {
          stores: { select: { lastSyncAt: true } },
        },
      },
    },
    orderBy: { organization: { name: 'asc' } },
  });

  return memberships.map((m) => {
    const o = m.organization;
    const lastSyncedAt = maxSyncedAt(o.stores);
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      currency: o.currency,
      timezone: o.timezone,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      role: m.role,
      storeCount: o.stores.length,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
      lastAccessedAt: m.lastAccessedAt?.toISOString() ?? null,
    };
  });
}

function maxSyncedAt(stores: Array<{ lastSyncAt: Date | null }>): Date | null {
  let max: Date | null = null;
  for (const s of stores) {
    if (s.lastSyncAt === null) continue;
    if (max === null || s.lastSyncAt > max) max = s.lastSyncAt;
  }
  return max;
}

/**
 * Create an organization and make the caller its OWNER, atomically.
 *
 * The two rows land in a single Prisma transaction — if membership
 * creation fails (e.g., FK violation when the user_profile row is
 * missing), the organization insert is rolled back too. No half-states.
 *
 * Prisma's DATABASE_URL connects as the `postgres` superuser, which
 * bypasses RLS. This is how the chicken-and-egg ("user must be a
 * member before inserting members") is resolved — the server owns the
 * first-membership write.
 *
 * Race on slug collision: two concurrent calls with the same name
 * both probe-find nothing, both attempt INSERT, one wins, the other
 * gets Prisma's P2002 unique-constraint violation. We retry the slug
 * generation once and try again. If it happens a second time (vanishingly
 * rare), the second caller's error bubbles up as 500 — better than a
 * user seeing a false "successful" response.
 */
const MAX_SLUG_RETRIES = 2;

export async function createForOwner(
  userId: string,
  input: CreateOrganizationInput,
): Promise<OrganizationCreated> {
  for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
    const slug = await generateUniqueOrganizationSlug(input.name);
    try {
      return await prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name: input.name, slug },
        });
        await tx.organizationMember.create({
          data: { organizationId: org.id, userId, role: 'OWNER' },
        });
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          currency: org.currency,
          timezone: org.timezone,
          createdAt: org.createdAt.toISOString(),
          updatedAt: org.updatedAt.toISOString(),
          role: 'OWNER' as const,
          storeCount: 0 as const,
          lastSyncedAt: null,
          lastAccessedAt: null,
          membership: { role: 'OWNER' as const },
        };
      });
    } catch (err) {
      // P2002 on slug during an earlier attempt → retry with a fresh slug.
      // On the LAST attempt (or a different error code), delegate to
      // mapPrismaError which either throws a typed domain error or rethrows.
      if (isSlugUniqueViolation(err) && attempt < MAX_SLUG_RETRIES - 1) continue;
      mapPrismaError(err);
    }
  }
  // Unreachable — mapPrismaError always throws on the last attempt.
  throw new Error('createForOwner: unreachable');
}

function isSlugUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}
