'use client';

import * as React from 'react';

import type { MarginScale } from '@/lib/margin-coloring';

/**
 * Shared margin-coloring context + consumer hook. Lives in `@/lib` (not a
 * feature) because the scale is a cross-cutting display concern read by many
 * domain surfaces (orders, product-pricing, live-performance) and shared
 * patterns (profit-cell, profit-breakdown) — none of which may import from a
 * feature. The value is PROVIDED by `MarginColoringProvider`
 * (`features/account`), mounted once in the dashboard layout.
 *
 * Values: `undefined` (loading) · `null` (disabled/unset) · `MarginScale` (active).
 */
export const MarginColoringContext = React.createContext<MarginScale | null | undefined>(undefined);

/**
 * Returns the user's active `MarginScale`, or `null` while loading / when the
 * scale is not configured or disabled. Consumers fall back to binary green/red
 * when this returns `null`. Must be called inside `MarginColoringProvider`.
 */
export function useMarginColoring(): MarginScale | null {
  const value = React.useContext(MarginColoringContext);
  // undefined = provider not yet resolved OR SSR default → treat as null (binary fallback).
  return value ?? null;
}
