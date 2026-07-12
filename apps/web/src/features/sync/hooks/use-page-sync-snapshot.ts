'use client';

import * as React from 'react';

import { useCurrentScope } from '@/providers/current-scope';

import type { PageSyncKey } from '../config/page-sync-sources';
import { derivePageSync, type PageSyncViewModel } from '../lib/derive-page-sync';
import { useOrgSyncs } from '../providers/org-syncs-provider';

/** Epoch stand-in for the derivation clock before the first client latch —
 *  nothing reads as stale (age against completedAt is negative), matching the
 *  SSR-safe pre-mount state. */
const EPOCH = new Date(0);

export interface PageSyncSnapshot extends PageSyncViewModel {
  /**
   * Latched reference "now" — `null` before the first client latch, then a
   * stable client `Date`. Feed to `TimeAgo`'s `now` prop so freshness labels
   * stay static across the second-by-second progress re-renders and only
   * re-anchor when the newest "last synced" value moves.
   */
  now: Date | null;
}

/**
 * Single derivation point for a page's sync-freshness view model. Reads the
 * org-wide sync buckets (activeSyncs / recentSyncs / freshness) plus the active
 * store, and projects them into the page's PageSyncViewModel via derivePageSync.
 *
 * Both PageSyncControl (the header freshness control) and PageSyncFooterTrace
 * (the "Son güncelleme" table-footer trace) consume this hook, so the derive
 * runs from one place instead of two divergent copies.
 *
 * `now` does NOT tick every second (no per-second subscription reaches the page
 * client or its DataTable): it is a latched snapshot. It re-latches at mount AND
 * every time the newest last-success timestamp changes — so the freshness label
 * is always measured from "when the data last changed", and right after a sync
 * finishes `recentLabel` reads "birkaç saniye önce" instead of the stale
 * page-open elapsed time. `null` until the first client latch keeps it SSR-safe
 * (`EPOCH` in the derivation, nothing reads as stale early).
 */
export function usePageSyncSnapshot(pageKey: PageSyncKey): PageSyncSnapshot {
  const { store } = useCurrentScope();
  const { activeSyncs, recentSyncs, freshness } = useOrgSyncs();
  const storeId = store?.id ?? '';

  // The latched reference clock. `null` before the first client latch (SSR-safe)
  // so consumers hand it straight to TimeAgo; the derivation falls back to EPOCH
  // so nothing reads as stale early.
  const [now, setNow] = React.useState<Date | null>(null);

  const viewModel = React.useMemo(
    () =>
      derivePageSync({
        pageKey,
        storeId,
        activeSyncs,
        recentSyncs,
        freshness,
        now: now ?? EPOCH,
      }),
    [pageKey, storeId, activeSyncs, recentSyncs, freshness, now],
  );

  // Re-latch the clock at mount AND whenever the newest last-success timestamp
  // moves. `control.lastSyncedAt` is derived purely from `freshness` (never from
  // `now`), so a clock refresh cannot change the value this effect keys on — no
  // render loop. The wall-clock read lives in the rAF callback, never
  // synchronously in the effect body (React Compiler flags a synchronous
  // setState-in-effect as a cascading render — the same defer pattern as
  // useCountUp). Effects never run on the server, so `now` stays null through
  // SSR + first paint and only latches on the client.
  const lastSyncedAt = viewModel.control.lastSyncedAt;
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setNow(new Date()));
    return () => cancelAnimationFrame(frame);
  }, [lastSyncedAt]);

  return React.useMemo(() => ({ ...viewModel, now }), [viewModel, now]);
}
