import { cookies } from 'next/headers';

/**
 * Active-org cookie helpers for Server Components / Server Actions.
 * The mutation functions live in `active-org-actions.ts` so they can
 * carry the `'use server'` directive separately — Server Action files
 * can only export async functions (no type re-exports).
 */

export const ACTIVE_ORG_COOKIE = 'last_org_id';

/**
 * Represents the minimum shape we need to resolve an active org from
 * the user's memberships. Matches the Organization type from
 * GET /v1/organizations.
 */
export interface OrgLike {
  id: string;
  name: string;
  createdAt: string;
}

export async function readActiveOrgId(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(ACTIVE_ORG_COOKIE)?.value;
}

/**
 * Resolve the active org id given the cookie and the user's memberships.
 *
 * ──────────────────────────────────────────────────────────────────────
 * [USER TOUCHPOINT #3 — Fallback ordering when the cookie is stale]
 *
 * Current policy: use the cookie if it points at an org the user
 * belongs to. Otherwise fall back to the FIRST org in the list as
 * returned by the API (the API sorts by name ASC — see
 * organization.service.ts::listForUser).
 *
 * Alternative policies worth considering:
 *   - Most-recently-created: `orgs.sort(by createdAt desc)[0]` — handy
 *     for power users who just spun up a new org in another tab.
 *   - Role-weighted: prefer an org where the user is OWNER over
 *     MEMBER/VIEWER — requires the list to carry role, which GET
 *     /v1/organizations doesn't today.
 *   - Alphabetical (current default via API sort): predictable across
 *     devices for the same user and zero extra data.
 *
 * Change the return line below if a different fallback fits the UX
 * you're aiming for.
 * ──────────────────────────────────────────────────────────────────────
 */
export async function resolveActiveOrgId(orgs: OrgLike[]): Promise<string | undefined> {
  if (orgs.length === 0) return undefined;
  const fromCookie = await readActiveOrgId();
  if (fromCookie !== undefined && orgs.some((o) => o.id === fromCookie)) {
    return fromCookie;
  }
  return orgs[0]?.id;
}
