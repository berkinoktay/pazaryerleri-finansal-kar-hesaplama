'use client';

import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { createClient } from './client';

/**
 * Wire shape of a sync_logs row arriving over postgres_changes. Mirrors
 * what Postgres logical decoding emits for our schema. We map this to
 * the same JSON shape our REST endpoint returns so consumers don't have
 * to deal with two response types.
 */
interface SyncLogsRowWire {
  id: string;
  store_id: string;
  sync_type: 'PRODUCTS' | 'ORDERS' | 'SETTLEMENTS';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  started_at: string;
  completed_at: string | null;
  records_processed: number;
  progress_current: number;
  progress_total: number | null;
  progress_stage: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface SyncLogRealtimeShape {
  id: string;
  storeId: SyncLogsRowWire['store_id'];
  syncType: SyncLogsRowWire['sync_type'];
  status: SyncLogsRowWire['status'];
  startedAt: string;
  completedAt: string | null;
  recordsProcessed: number;
  progressCurrent: number;
  progressTotal: number | null;
  progressStage: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SyncLogRealtimeEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  /** New row state. Null only on DELETE events. */
  row: SyncLogRealtimeShape | null;
  /** Row id — present on every event including DELETE. */
  id: string;
}

/**
 * Channel health, surfaced to consumers so they can gate a polling
 * fallback on it. `healthy` is true only while we believe the WebSocket
 * is delivering events; everything else (connecting, dropped, errored,
 * tab hidden) is unhealthy and the consumer should poll.
 */
export type RealtimeHealth = 'healthy' | 'connecting' | 'errored' | 'paused';

function snakeToCamel(row: SyncLogsRowWire): SyncLogRealtimeShape {
  return {
    id: row.id,
    storeId: row.store_id,
    syncType: row.sync_type,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    recordsProcessed: row.records_processed,
    progressCurrent: row.progress_current,
    progressTotal: row.progress_total,
    progressStage: row.progress_stage,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

export interface SubscribeToOrgSyncsOptions {
  /** Per-event handler. Fires once per Realtime postgres_changes payload. */
  onEvent: (event: SyncLogRealtimeEvent) => void;
  /**
   * Channel health changed. Consumers use this to gate a polling
   * fallback: poll only when health is not `'healthy'`. Called
   * synchronously with `'connecting'` immediately after subscribe(),
   * then again on each transition (SUBSCRIBED → `'healthy'`,
   * CHANNEL_ERROR / TIMED_OUT / CLOSED → `'errored'`, visibilitychange
   * `hidden` → `'paused'`).
   */
  onHealthChange?: (health: RealtimeHealth) => void;
}

/**
 * Subscribe to postgres_changes on `public.sync_logs` filtered by
 * `organization_id`. Org-wide subscription — used by the dashboard-shell
 * OrgSyncsProvider so a single channel surfaces every sync across every
 * store the user can see in the active org.
 *
 * The flat `is_org_member(organization_id)` RLS policy on sync_logs
 * (PR #60 — denormalized organization_id) lets Realtime's
 * postgres_changes evaluator gate rows by membership without a
 * cross-table walk.
 *
 * **Connection lifecycle.** Supabase's Realtime client retries the
 * underlying WebSocket on its own, but the per-channel subscription
 * status drives the consumer's polling-fallback decision. We translate
 * the four meaningful states into a `RealtimeHealth` union and push
 * them through `onHealthChange`:
 *
 *   - `connecting` — initial state until SUBSCRIBED arrives.
 *   - `healthy`    — the channel is live and delivering events. Polling
 *                    should be off.
 *   - `errored`    — CHANNEL_ERROR / TIMED_OUT / CLOSED. Polling fills
 *                    in until the next SUBSCRIBED.
 *   - `paused`     — we explicitly removed the channel because the tab
 *                    is hidden (see visibility handling below). Polling
 *                    is also off because nobody is watching.
 *
 * **Tab visibility.** Browsers throttle background tabs aggressively;
 * we go further and tear the channel down entirely on `visibilitychange`
 * (`hidden`), then re-subscribe on `visible`. Saves WebSocket overhead
 * for the common case of a merchant leaving the dashboard in a
 * background tab — and frees the consumer's polling-gate logic from
 * trying to distinguish "channel is up but tab is dormant" from
 * "channel is up and we're watching."
 *
 * Returns an unsubscribe function. Caller calls on unmount;
 * OrgSyncsProvider does this in its cleanup.
 */
export function subscribeToOrgSyncs(
  orgId: string,
  options: SubscribeToOrgSyncsOptions,
): () => void {
  const { onEvent, onHealthChange } = options;
  const supabase = createClient();
  let channel: RealtimeChannel | null = null;
  let unsubscribed = false;

  const reportHealth = (next: RealtimeHealth): void => {
    if (onHealthChange !== undefined) onHealthChange(next);
  };

  const buildChannel = (): RealtimeChannel => {
    reportHealth('connecting');
    return supabase
      .channel(`sync_logs:org:${orgId}`)
      .on<SyncLogsRowWire>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sync_logs',
          filter: `organization_id=eq.${orgId}`,
        },
        (payload: RealtimePostgresChangesPayload<SyncLogsRowWire>) => {
          const eventType = payload.eventType;
          if (eventType === 'DELETE') {
            const oldRow = payload.old as Partial<SyncLogsRowWire>;
            if (oldRow.id === undefined) return;
            onEvent({ eventType: 'DELETE', id: oldRow.id, row: null });
            return;
          }
          const newRow = payload.new as SyncLogsRowWire;
          onEvent({
            eventType,
            id: newRow.id,
            row: snakeToCamel(newRow),
          });
        },
      )
      .subscribe((status) => {
        if (unsubscribed) return;
        // Status values: SUBSCRIBED | TIMED_OUT | CLOSED | CHANNEL_ERROR | (transient others)
        if (status === 'SUBSCRIBED') reportHealth('healthy');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          reportHealth('errored');
        }
      });
  };

  const teardown = async (): Promise<void> => {
    if (channel === null) return;
    const c = channel;
    channel = null;
    await supabase.removeChannel(c);
  };

  // Visibility handler — only wired in real browsers. SSR / vitest-happy-dom
  // both expose `document` so the typeof check is enough to keep node-only
  // test contexts safe.
  const handleVisibility = (): void => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      reportHealth('paused');
      void teardown();
    } else if (channel === null) {
      channel = buildChannel();
    }
  };

  channel = buildChannel();

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }

  return () => {
    unsubscribed = true;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
    void teardown();
  };
}
