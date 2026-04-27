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

function snakeToCamel(row: SyncLogsRowWire): SyncLogRealtimeShape {
  return {
    id: row.id,
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

/**
 * Subscribe to postgres_changes on `public.sync_logs` filtered by
 * `store_id`. RLS policies on the table apply to the subscription —
 * a user with no membership in the store's org receives nothing.
 *
 * Returns an unsubscribe function. Caller is responsible for calling
 * it on unmount; `useActiveSyncLogs` does this in its cleanup.
 *
 * Reconnection is handled by the Supabase Realtime client out of the
 * box — when the WebSocket drops the channel automatically retries
 * with exponential backoff. While disconnected, the consuming hook's
 * polling fallback (React Query `refetchInterval`) keeps progress
 * updated; once the channel comes back, the next event reconciles
 * the cache.
 */
export function subscribeToSyncLogs(
  storeId: string,
  onEvent: (event: SyncLogRealtimeEvent) => void,
): () => void {
  const supabase = createClient();
  const channel: RealtimeChannel = supabase
    .channel(`sync_logs:${storeId}`)
    .on<SyncLogsRowWire>(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'sync_logs',
        filter: `store_id=eq.${storeId}`,
      },
      (payload: RealtimePostgresChangesPayload<SyncLogsRowWire>) => {
        const eventType = payload.eventType;
        // Postgres logical decoding sends `new` on INSERT/UPDATE and
        // `old` on DELETE. We always need an id; it lives on whichever
        // record is present.
        if (eventType === 'DELETE') {
          const oldRow = payload.old as Partial<SyncLogsRowWire>;
          if (oldRow.id === undefined) return; // malformed — skip
          onEvent({ eventType: 'DELETE', id: oldRow.id, row: null });
          return;
        }
        // INSERT / UPDATE — `new` is the full row.
        const newRow = payload.new as SyncLogsRowWire;
        onEvent({
          eventType,
          id: newRow.id,
          row: snakeToCamel(newRow),
        });
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
