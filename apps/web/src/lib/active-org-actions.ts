'use server';

import { cookies } from 'next/headers';

import { getServerApiClient } from '@/lib/api-client/server';

import { ACTIVE_ORG_COOKIE } from './active-org';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Persist the active org id for this browser AND record the access
 * timestamp on the server.
 *
 * Two side effects, deliberately:
 *   1. Browser cookie (`last_org_id`) — the FE reads it on layout
 *      render to resolve which org to fetch stores for. `httpOnly: false`
 *      because the client also reads it to highlight the active row, and
 *      the value isn't a secret (backend re-derives authz from the JWT).
 *   2. `POST /v1/organizations/{orgId}/access` — bumps the caller's
 *      `organization_members.last_accessed_at`. Powers the "Son
 *      Kullanılan" pinned section in the org switcher dropdown when the
 *      user belongs to many orgs.
 *
 * Failure mode: the cookie write always succeeds locally (it's just
 * setting a Set-Cookie header). The backend access call may fail (404
 * if the user isn't a member, network blip, etc.) — we deliberately
 * swallow that failure here so a stale tracking call doesn't block
 * the user from switching orgs. The cookie still flips and the layout
 * re-renders with the new active org. `lastAccessedAt` self-heals on
 * the next successful switch.
 */
export async function setActiveOrgIdAction(orgId: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACTIVE_ORG_COOKIE, orgId, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: ONE_YEAR_SECONDS,
  });

  try {
    const api = await getServerApiClient();
    await api.POST('/v1/organizations/{orgId}/access', { params: { path: { orgId } } });
  } catch {
    // Intentionally swallowed — see JSDoc above. The cookie flip is
    // the primary effect; `lastAccessedAt` is best-effort metadata.
  }
}

export async function clearActiveOrgIdAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACTIVE_ORG_COOKIE);
}
