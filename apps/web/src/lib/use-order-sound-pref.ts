'use client';

import * as React from 'react';

const SOUND_PREF_KEY = 'pazarsync.live.sound';
// Same-tab change signal. The native 'storage' event fires only in OTHER tabs,
// so a write dispatches this so every useOrderSoundPref consumer in THIS tab
// re-reads (the user-menu toggle and the notifier stay in sync).
const SOUND_PREF_EVENT = 'pazarsync:sound-pref';

function readStoredPref(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    // Default ON: only an explicit 'false' disables.
    return window.localStorage.getItem(SOUND_PREF_KEY) !== 'false';
  } catch {
    return true;
  }
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(SOUND_PREF_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(SOUND_PREF_EVENT, onStoreChange);
  };
}

export interface OrderSoundPref {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
}

/**
 * localStorage-backed "order notification sound" preference, default ON.
 *
 * Backed by useSyncExternalStore (the same idiom as useIsMounted) so the value
 * reads from storage without a setState-in-effect: SSR + hydration use the
 * deterministic `true` server snapshot, then the client snapshot reconciles to
 * the stored value with no hydration mismatch. A write notifies every consumer
 * in the tab, so toggling the sound in the account menu updates the notifier
 * immediately.
 */
export function useOrderSoundPref(): OrderSoundPref {
  const enabled = React.useSyncExternalStore(subscribe, readStoredPref, () => true);

  const setEnabled = React.useCallback((value: boolean): void => {
    try {
      window.localStorage.setItem(SOUND_PREF_KEY, value ? 'true' : 'false');
    } catch {
      // localStorage unavailable (private mode / quota) -- the next read falls back to default.
    }
    window.dispatchEvent(new Event(SOUND_PREF_EVENT));
  }, []);

  return { enabled, setEnabled };
}
