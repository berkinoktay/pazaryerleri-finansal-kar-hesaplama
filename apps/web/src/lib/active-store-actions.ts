'use server';

import { cookies } from 'next/headers';

import { ACTIVE_STORE_COOKIE } from './active-store';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Persist the active store id for this browser. `httpOnly: false` so
 * the client-side StoreSwitcher can read it for highlight; the value
 * is not a secret because the backend always re-derives store
 * authorisation from the JWT + organizationId path param.
 */
export async function setActiveStoreIdAction(storeId: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACTIVE_STORE_COOKIE, storeId, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: ONE_YEAR_SECONDS,
  });
}

export async function clearActiveStoreIdAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACTIVE_STORE_COOKIE);
}
