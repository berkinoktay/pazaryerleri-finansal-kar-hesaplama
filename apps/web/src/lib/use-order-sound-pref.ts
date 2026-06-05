'use client';

import * as React from 'react';

import { useIsMounted } from '@/lib/use-is-mounted';

const SOUND_PREF_KEY = 'pazarsync.live.sound';

function readStoredPref(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    // Default ON: only an explicit 'false' disables.
    return window.localStorage.getItem(SOUND_PREF_KEY) !== 'false';
  } catch {
    return true;
  }
}

export interface OrderSoundPref {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
}

/**
 * localStorage-backed "order notification sound" preference, default ON.
 * Hydration-safe: SSR + first client render return `true` (deterministic);
 * the stored value is reconciled in a post-mount effect, and the returned
 * value is mount-gated so the first paint never diverges from the server.
 */
export function useOrderSoundPref(): OrderSoundPref {
  const mounted = useIsMounted();
  const [enabled, setEnabledState] = React.useState(true);

  React.useEffect(() => {
    setEnabledState(readStoredPref());
  }, []);

  const setEnabled = React.useCallback((value: boolean): void => {
    setEnabledState(value);
    try {
      window.localStorage.setItem(SOUND_PREF_KEY, value ? 'true' : 'false');
    } catch {
      // localStorage unavailable (private mode / quota) -- keep in-memory state.
    }
  }, []);

  return { enabled: mounted ? enabled : true, setEnabled };
}
