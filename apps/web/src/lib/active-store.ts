import { cookies } from 'next/headers';

/**
 * Active-store cookie helpers — twin of active-org. Mutation lives in
 * `active-store-actions.ts` so the `'use server'` directive stays
 * scoped to actual Server Actions.
 */

export const ACTIVE_STORE_COOKIE = 'last_store_id';

export interface StoreLike {
  id: string;
}

export async function readActiveStoreId(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(ACTIVE_STORE_COOKIE)?.value;
}

/**
 * Resolve the active store id given the cookie and the org's stores.
 * Cookie wins when it points at a store the org still owns; otherwise
 * the first store wins (backend orders by createdAt ASC). Returns
 * undefined when the org has no stores yet — the rail switcher renders
 * an empty-state CTA instead.
 */
export async function resolveActiveStoreId(stores: StoreLike[]): Promise<string | undefined> {
  if (stores.length === 0) return undefined;
  const fromCookie = await readActiveStoreId();
  if (fromCookie !== undefined && stores.some((s) => s.id === fromCookie)) {
    return fromCookie;
  }
  return stores[0]?.id;
}
