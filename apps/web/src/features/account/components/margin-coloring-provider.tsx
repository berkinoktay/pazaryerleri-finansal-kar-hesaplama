'use client';

import * as React from 'react';

import type { MarginScale } from '@/lib/margin-coloring';
import { MarginColoringContext } from '@/lib/margin-coloring-context';

import { useMyPreferences } from '../hooks/use-my-preferences';

/**
 * Reads the user's marginColoring preference via `useMyPreferences()` and
 * provides a `MarginScale | null` to all descendants through the shared
 * `MarginColoringContext` (`@/lib/margin-coloring-context`).
 *
 * Mount ONCE in the dashboard layout, next to OrgSyncsProvider and
 * CurrentScopeProvider. Consumers call `useMarginColoring()` from
 * `@/lib/margin-coloring-context`.
 *
 * Return values flowing through the context:
 *   undefined  — still loading (before first successful fetch)
 *   null       — loaded but marginColoring is not configured / disabled
 *   MarginScale — loaded and the user has an active scale
 *
 * SSR-safe: the server renders undefined (context default), the first client
 * paint resolves to null until React Query delivers data. Both states produce
 * the binary color fallback — no hydration mismatch.
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
