'use client';

import { useSyncExternalStore } from 'react';

/**
 * Live "current time" for components rendering countdowns or
 * elapsed-time labels (the SyncCenter "Yeniden denenecek X saniye sonra"
 * row, future "Son senkron N dk önce" labels, etc.). Returns `null`
 * during SSR / first hydration render, then an updated `Date` on every
 * 1 Hz tick once the component is on the client.
 *
 * Tab-aware: pauses while `document.visibilityState === 'hidden'` so a
 * backgrounded tab doesn't drain battery, and refreshes immediately on
 * `visible` so the user sees the right time the moment they look.
 *
 * SSR safety: pair with the standard hydration pattern — when the
 * return value is `null`, render an absolute timestamp; once non-null,
 * swap to the live relative label. Server and client first-paint
 * markup is byte-identical (both `null`).
 *
 * Implementation: `useSyncExternalStore` over a module-singleton store.
 * One `setInterval` is shared across every consumer in the tree, so a
 * SyncCenter with five retrying rows still ticks at 1 Hz (not 5 Hz).
 * The same pattern that `useIsMounted` uses to avoid the React Compiler
 * lint rule against `setState` inside `useEffect` bodies.
 *
 * Performance: 1 Hz updates, only while the tab is visible AND at
 * least one consumer is mounted. No work on a hidden tab. No work
 * when no component subscribes.
 */

const TICK_MS = 1_000;

let cachedNow: Date | null = null;
const subscribers = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let visibilityListenerInstalled = false;

function notifyAll(): void {
  for (const fn of subscribers) fn();
}

function tick(): void {
  cachedNow = new Date();
  notifyAll();
}

function startInterval(): void {
  if (intervalId !== null) return;
  intervalId = setInterval(tick, TICK_MS);
}

function stopInterval(): void {
  if (intervalId === null) return;
  clearInterval(intervalId);
  intervalId = null;
}

function handleVisibility(): void {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'visible') {
    // Catch up immediately on tab focus so the displayed countdown is
    // accurate the moment the user looks at it again.
    tick();
    if (subscribers.size > 0) startInterval();
  } else {
    stopInterval();
  }
}

function subscribe(notify: () => void): () => void {
  if (cachedNow === null) cachedNow = new Date();
  subscribers.add(notify);

  if (!visibilityListenerInstalled && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
    visibilityListenerInstalled = true;
  }

  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
    startInterval();
  }

  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0) {
      stopInterval();
      // Listener stays installed across full unmount/remount cycles
      // (cheap; one global listener) so tab focus during a remount-gap
      // doesn't lose the tick. Modules don't get re-evaluated outside
      // tests, so this is effectively a one-time cost.
    }
  };
}

const getSnapshot = (): Date | null => cachedNow;
const getServerSnapshot = (): Date | null => null;

export function useNow(): Date | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Test helper — vitest uses fake timers and we need a hook to reset
// the module-level singletons between tests so subscribers from a
// previous test don't carry over.
export function __resetUseNowForTest(): void {
  cachedNow = null;
  subscribers.clear();
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (visibilityListenerInstalled && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibility);
    visibilityListenerInstalled = false;
  }
}
