import { describe, expect, it } from 'vitest';

import type { SyncLog } from '@/features/sync/api/list-org-sync-logs.api';
import {
  OUTAGE_POLL_INTERVAL_MS,
  RECONCILE_INTERVAL_MS,
  computeSyncRefetchInterval,
} from '@/features/sync/lib/sync-refetch-interval';

function makeLog(status: SyncLog['status']): SyncLog {
  return {
    id: 'log-1',
    organizationId: 'org-1',
    storeId: 'store-1',
    syncType: 'PRODUCTS',
    status,
    startedAt: '2026-07-11T12:00:00.000Z',
    completedAt: null,
    recordsProcessed: 0,
    progressCurrent: 0,
    progressTotal: null,
    progressStage: null,
    errorCode: null,
    errorMessage: null,
    attemptCount: 0,
    nextAttemptAt: null,
    skippedPages: null,
  };
}

describe('computeSyncRefetchInterval', () => {
  it('exposes the documented interval constants', () => {
    expect(RECONCILE_INTERVAL_MS).toBe(30_000);
    expect(OUTAGE_POLL_INTERVAL_MS).toBe(10_000);
  });

  it('never polls while paused, even with an active sync in flight', () => {
    expect(computeSyncRefetchInterval('paused', [makeLog('RUNNING')])).toBe(false);
  });

  it('does not poll while healthy with no cached rows (undefined)', () => {
    expect(computeSyncRefetchInterval('healthy', undefined)).toBe(false);
  });

  it('does not poll while healthy with an empty cache', () => {
    expect(computeSyncRefetchInterval('healthy', [])).toBe(false);
  });

  it('runs the slow reconcile floor while healthy with an active sync', () => {
    expect(computeSyncRefetchInterval('healthy', [makeLog('RUNNING')])).toBe(RECONCILE_INTERVAL_MS);
  });

  it('does not poll while healthy when only terminal rows are cached', () => {
    expect(computeSyncRefetchInterval('healthy', [makeLog('COMPLETED'), makeLog('FAILED')])).toBe(
      false,
    );
  });

  it('polls unconditionally while errored with undefined rows', () => {
    expect(computeSyncRefetchInterval('errored', undefined)).toBe(OUTAGE_POLL_INTERVAL_MS);
  });

  it('polls unconditionally while errored with an empty cache', () => {
    expect(computeSyncRefetchInterval('errored', [])).toBe(OUTAGE_POLL_INTERVAL_MS);
  });

  it('polls unconditionally while connecting with an active sync', () => {
    expect(computeSyncRefetchInterval('connecting', [makeLog('RUNNING')])).toBe(
      OUTAGE_POLL_INTERVAL_MS,
    );
  });
});
