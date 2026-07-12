import { describe, expect, it } from 'vitest';

import {
  RECENT_LIMIT,
  applySyncLogEvent,
  type OrgSyncsCache,
} from '@/features/sync/lib/org-syncs-cache';
import type { SyncLogRealtimeEvent, SyncLogRealtimeShape } from '@/lib/supabase/realtime';

const ORG = '00000000-0000-0000-0000-000000000099';
const STORE_A = '00000000-0000-0000-0000-0000000000aa';

const EMPTY: OrgSyncsCache = { logs: [], freshness: [] };

function makeRow(overrides: Partial<SyncLogRealtimeShape> = {}): SyncLogRealtimeShape {
  return {
    id: overrides.id ?? 'log-1',
    organizationId: overrides.organizationId ?? ORG,
    storeId: overrides.storeId ?? STORE_A,
    syncType: overrides.syncType ?? 'PRODUCTS',
    status: overrides.status ?? 'RUNNING',
    startedAt: overrides.startedAt ?? '2026-04-27T12:00:00Z',
    completedAt: overrides.completedAt ?? null,
    recordsProcessed: overrides.recordsProcessed ?? 0,
    progressCurrent: overrides.progressCurrent ?? 0,
    progressTotal: overrides.progressTotal ?? null,
    progressStage: overrides.progressStage ?? null,
    errorCode: overrides.errorCode ?? null,
    errorMessage: overrides.errorMessage ?? null,
    attemptCount: overrides.attemptCount ?? 0,
    nextAttemptAt: overrides.nextAttemptAt ?? null,
    skippedPages: overrides.skippedPages ?? null,
  };
}

function upsertEvent(row: SyncLogRealtimeShape): SyncLogRealtimeEvent {
  return { eventType: 'UPDATE', id: row.id, row };
}

function deleteEvent(id: string): SyncLogRealtimeEvent {
  return { eventType: 'DELETE', id, row: null };
}

describe('applySyncLogEvent — log list', () => {
  it('keeps active rows ahead of recent rows regardless of startedAt', () => {
    let cache = applySyncLogEvent(
      EMPTY,
      upsertEvent(
        makeRow({
          id: 'done',
          status: 'COMPLETED',
          startedAt: '2026-04-27T09:00:00Z',
          completedAt: '2026-04-27T09:05:00Z',
        }),
      ),
    );
    // The running row started EARLIER than the completed one but must still sort first.
    cache = applySyncLogEvent(
      cache,
      upsertEvent(makeRow({ id: 'running', status: 'RUNNING', startedAt: '2026-04-27T08:00:00Z' })),
    );

    expect(cache.logs.map((log) => log.id)).toEqual(['running', 'done']);
  });

  it('caps the recent (non-active) tail at RECENT_LIMIT, newest first', () => {
    let cache: OrgSyncsCache = EMPTY;
    for (let i = 0; i < RECENT_LIMIT + 2; i += 1) {
      cache = applySyncLogEvent(
        cache,
        upsertEvent(
          makeRow({
            id: `done-${i}`,
            status: 'COMPLETED',
            startedAt: `2026-04-27T1${i}:00:00Z`,
            completedAt: `2026-04-27T1${i}:05:00Z`,
          }),
        ),
      );
    }

    expect(cache.logs).toHaveLength(RECENT_LIMIT);
    // Newest completed row first; the two oldest fell off the cap.
    expect(cache.logs[0]?.id).toBe(`done-${RECENT_LIMIT + 1}`);
    expect(cache.logs.map((log) => log.id)).not.toContain('done-0');
    expect(cache.logs.map((log) => log.id)).not.toContain('done-1');
  });

  it('drops a row on a DELETE event', () => {
    let cache = applySyncLogEvent(EMPTY, upsertEvent(makeRow({ id: 'r1', status: 'RUNNING' })));
    expect(cache.logs).toHaveLength(1);

    cache = applySyncLogEvent(cache, deleteEvent('r1'));
    expect(cache.logs).toEqual([]);
  });

  it('does not mutate the input cache', () => {
    const input: OrgSyncsCache = { logs: [], freshness: [] };
    applySyncLogEvent(
      input,
      upsertEvent(makeRow({ status: 'COMPLETED', completedAt: '2026-04-27T10:00:00Z' })),
    );

    expect(input.logs).toEqual([]);
    expect(input.freshness).toEqual([]);
  });
});

describe('applySyncLogEvent — freshness', () => {
  it('adds a freshness entry on a COMPLETED event', () => {
    const cache = applySyncLogEvent(
      EMPTY,
      upsertEvent(
        makeRow({
          id: 'c1',
          status: 'COMPLETED',
          syncType: 'ORDERS',
          completedAt: '2026-04-27T10:00:00Z',
          recordsProcessed: 12,
        }),
      ),
    );

    expect(cache.freshness).toHaveLength(1);
    expect(cache.freshness[0]).toMatchObject({
      storeId: STORE_A,
      syncType: 'ORDERS',
      completedAt: '2026-04-27T10:00:00Z',
      recordsProcessed: 12,
    });
  });

  it('advances freshness when a newer COMPLETED arrives for the same (store, syncType)', () => {
    let cache = applySyncLogEvent(
      EMPTY,
      upsertEvent(
        makeRow({
          id: 'c1',
          status: 'COMPLETED',
          syncType: 'ORDERS',
          completedAt: '2026-04-27T10:00:00Z',
          recordsProcessed: 5,
        }),
      ),
    );
    cache = applySyncLogEvent(
      cache,
      upsertEvent(
        makeRow({
          id: 'c2',
          status: 'COMPLETED',
          syncType: 'ORDERS',
          completedAt: '2026-04-27T12:00:00Z',
          recordsProcessed: 9,
        }),
      ),
    );

    expect(cache.freshness).toHaveLength(1);
    expect(cache.freshness[0]?.completedAt).toBe('2026-04-27T12:00:00Z');
    expect(cache.freshness[0]?.recordsProcessed).toBe(9);
  });

  it('does not regress freshness on an older, late-arriving COMPLETED event', () => {
    let cache = applySyncLogEvent(
      EMPTY,
      upsertEvent(
        makeRow({
          id: 'c2',
          status: 'COMPLETED',
          syncType: 'ORDERS',
          completedAt: '2026-04-27T12:00:00Z',
          recordsProcessed: 9,
        }),
      ),
    );
    const before = cache.freshness;

    // Older event arriving late — must not roll the timestamp back.
    cache = applySyncLogEvent(
      cache,
      upsertEvent(
        makeRow({
          id: 'c1',
          status: 'COMPLETED',
          syncType: 'ORDERS',
          completedAt: '2026-04-27T10:00:00Z',
          recordsProcessed: 5,
        }),
      ),
    );

    expect(cache.freshness[0]?.completedAt).toBe('2026-04-27T12:00:00Z');
    // Untouched — same array reference returned.
    expect(cache.freshness).toBe(before);
  });

  it('keeps separate freshness entries per (store, syncType)', () => {
    let cache = applySyncLogEvent(
      EMPTY,
      upsertEvent(
        makeRow({ status: 'COMPLETED', syncType: 'ORDERS', completedAt: '2026-04-27T10:00:00Z' }),
      ),
    );
    cache = applySyncLogEvent(
      cache,
      upsertEvent(
        makeRow({ status: 'COMPLETED', syncType: 'PRODUCTS', completedAt: '2026-04-27T10:00:00Z' }),
      ),
    );

    expect(cache.freshness).toHaveLength(2);
    expect(cache.freshness.map((entry) => entry.syncType)).toEqual(['ORDERS', 'PRODUCTS']);
  });

  it('leaves freshness untouched on a RUNNING event', () => {
    const cache = applySyncLogEvent(EMPTY, upsertEvent(makeRow({ status: 'RUNNING' })));
    expect(cache.freshness).toEqual([]);
  });

  it('does not advance freshness on a COMPLETED row with a null completedAt', () => {
    const cache = applySyncLogEvent(
      EMPTY,
      upsertEvent(makeRow({ status: 'COMPLETED', completedAt: null })),
    );
    expect(cache.freshness).toEqual([]);
  });

  it('leaves freshness untouched on a DELETE event while still dropping the log row', () => {
    let cache = applySyncLogEvent(
      EMPTY,
      upsertEvent(makeRow({ id: 'c1', status: 'COMPLETED', completedAt: '2026-04-27T10:00:00Z' })),
    );
    const before = cache.freshness;

    cache = applySyncLogEvent(cache, deleteEvent('c1'));

    expect(cache.freshness).toBe(before);
    expect(cache.logs).toEqual([]);
  });
});
