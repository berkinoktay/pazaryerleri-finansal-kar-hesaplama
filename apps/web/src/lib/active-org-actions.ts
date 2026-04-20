'use server';

import { cookies } from 'next/headers';

import { ACTIVE_ORG_COOKIE } from './active-org';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Persist the active org id for this browser. `httpOnly: false` is
 * deliberate — the client-side OrgSwitcher reads the cookie to
 * highlight the active row, and the value is not a secret (backend
 * always re-derives authorisation from the JWT).
 */
export async function setActiveOrgIdAction(orgId: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACTIVE_ORG_COOKIE, orgId, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: ONE_YEAR_SECONDS,
  });
}

export async function clearActiveOrgIdAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACTIVE_ORG_COOKIE);
}
