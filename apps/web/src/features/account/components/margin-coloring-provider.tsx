'use client';

import * as React from 'react';

import type { MarginScale } from '@/lib/margin-coloring';

import { useMyPreferences } from '../hooks/use-my-preferences';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const MarginColoringContext = React.createContext<MarginScale | null | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Reads the user's marginColoring preference via `useMyPreferences()` and
 * exposes a `MarginScale | null` to all descendants via context.
 *
 * Return values:
 *   undefined  — still loading (before first successful fetch)
 *   null       — loaded but marginColoring is not configured / disabled
 *   MarginScale — loaded and the user has an active scale
 *
 * Mount ONCE in the dashboard layout, next to OrgSyncsProvider and
 * CurrentScopeProvider. Consumers call `useMarginColoring()`.
 *
 * SSR-safe: the server renders undefined (context default), the first client
 * paint resolves to null until React Query delivers data. Both states
 * produce the binary color fallback — no hydration mismatch.
 */
export function MarginColoringProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const { data: preferences, isSuccess } = useMyPreferences();

  // Derive scale during render — no useEffect-for-derived-state.
  // undefined while query hasn't resolved; null when no marginColoring set.
  const scale: MarginScale | null | undefined = isSuccess
    ? (preferences?.marginColoring ?? null)
    : undefined;

  return <MarginColoringContext.Provider value={scale}>{children}</MarginColoringContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the user's active `MarginScale`, or `null` while loading / when
 * the scale is not configured or is disabled. Consumers should fall back to
 * binary green/red when this returns null.
 *
 * Must be called inside `MarginColoringProvider`.
 */
export function useMarginColoring(): MarginScale | null {
  const value = React.useContext(MarginColoringContext);
  // undefined means the provider is not yet resolved — treat as null (binary fallback).
  // This also handles the SSR case where the context is the default undefined.
  return value ?? null;
}
