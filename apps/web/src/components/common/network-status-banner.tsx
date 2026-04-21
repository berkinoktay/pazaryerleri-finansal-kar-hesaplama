'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Top-fixed banner that surfaces when the browser loses network
 * connectivity. Paired with the global `QueryProvider` onError which
 * suppresses `NETWORK_ERROR` toasts while this banner is visible —
 * one clear signal beats two (banner + toast stacks).
 *
 * On reconnect, invalidates every query so the UI pulls fresh data
 * rather than showing stale cached values from the offline window.
 *
 * State read via `useSyncExternalStore` — correct pattern for
 * browser-owned state (no `setState` in an effect, no hydration
 * mismatch). Server snapshot assumes online; the first client render
 * reconciles to the real value via `onLine`.
 */
function subscribeOnlineStatus(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

function getOnlineServerSnapshot(): boolean {
  // Server can't observe the client's connection — assume online.
  // First client render will flip if offline, which is acceptable
  // because this component renders nothing in the online state.
  return true;
}

export function NetworkStatusBanner(): React.ReactElement | null {
  const t = useTranslations('common.networkStatus');
  const queryClient = useQueryClient();
  const isOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineSnapshot,
    getOnlineServerSnapshot,
  );
  const previousOnlineRef = useRef(isOnline);

  useEffect(() => {
    const wasOffline = previousOnlineRef.current === false;
    previousOnlineRef.current = isOnline;
    if (wasOffline && isOnline) {
      // Re-fetch everything; data cached during the offline window
      // may be stale or point at a half-applied write.
      void queryClient.invalidateQueries();
    }
  }, [isOnline, queryClient]);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-destructive text-destructive-foreground px-md py-xs pointer-events-auto fixed inset-x-0 top-0 z-50 text-center text-sm font-medium"
    >
      {t('offline')}
    </div>
  );
}
