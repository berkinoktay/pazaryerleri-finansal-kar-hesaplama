'use client';

import * as React from 'react';

import { useIsMounted } from '@/lib/use-is-mounted';

export interface ClientOnlyProps {
  /** The client-only subtree. Rendered only after hydration. */
  children: React.ReactNode;
  /**
   * Rendered during SSR and on the first client render. MUST produce the same
   * markup on both sides — typically a placeholder, skeleton, or a neutral
   * version of the client content. Defaults to `null`.
   */
  fallback?: React.ReactNode;
}

/**
 * Wrapper that defers rendering of its children until after the first client
 * render. Used to contain hydration mismatches caused by reading client-only
 * state (user theme, locale preference, relative time, `localStorage`) during
 * SSR.
 *
 * Rules for the fallback:
 * 1. Pick something that produces deterministic HTML on server and client.
 * 2. Try to keep layout stable — same box dimensions — so the swap does not
 *    shift the page.
 * 3. When unsure, pass a neutral placeholder rather than `null`; empty boxes
 *    create layout jumps that feel worse than a brief visual flash.
 */
export function ClientOnly({ children, fallback = null }: ClientOnlyProps): React.ReactElement {
  const mounted = useIsMounted();
  return <>{mounted ? children : fallback}</>;
}
