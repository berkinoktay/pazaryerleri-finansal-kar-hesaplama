'use client';

import { useSyncExternalStore } from 'react';

/**
 * Returns `true` after the component has mounted on the client, `false`
 * during SSR and on the first hydration render. Use this to gate UI that
 * depends on client-only state (localStorage, matchMedia, Date.now, user
 * prefs) so the server-rendered markup is deterministic and React can
 * hydrate without a mismatch.
 *
 * Implemented with `useSyncExternalStore` — the canonical React pattern for
 * returning distinct server vs. client snapshots — rather than the
 * `useState` + `useEffect` dance (which the React Compiler linter flags as
 * a cascading render).
 *
 * Pair with `ClientOnly` when the gated content is a subtree. Use the hook
 * directly when you need to swap a prop or className conditionally.
 */
const emptySubscribe = (): (() => void) => () => undefined;
const getClientSnapshot = (): boolean => true;
const getServerSnapshot = (): boolean => false;

export function useIsMounted(): boolean {
  return useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);
}
