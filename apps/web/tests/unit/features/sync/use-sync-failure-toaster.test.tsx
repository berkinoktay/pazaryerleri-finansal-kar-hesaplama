import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SyncLog } from '@/features/sync/api/list-org-sync-logs.api';
import { useSyncFailureToaster } from '@/features/sync/hooks/use-sync-failure-toaster';

const STORE = 'store-1';
const OTHER_STORE = 'store-2';

function makeLog(
  overrides: Partial<SyncLog> & Pick<SyncLog, 'id' | 'syncType' | 'status'>,
): SyncLog {
  return {
    organizationId: 'org-1',
    storeId: STORE,
    startedAt: '2026-07-13T11:00:00.000Z',
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
    ...overrides,
  };
}

interface Props {
  activeSyncs: SyncLog[];
  recentSyncs: SyncLog[];
  onFailure: (log: SyncLog) => void;
}

function renderToaster(initial: Props) {
  return renderHook(
    (props: Props) =>
      useSyncFailureToaster({
        storeId: STORE,
        activeSyncs: props.activeSyncs,
        recentSyncs: props.recentSyncs,
        onFailure: props.onFailure,
      }),
    { initialProps: initial },
  );
}

describe('useSyncFailureToaster', () => {
  it('fires once when an active flow exits as terminal FAILED', () => {
    const onFailure = vi.fn();
    const { rerender } = renderToaster({
      activeSyncs: [makeLog({ id: 'a', syncType: 'PRODUCTS', status: 'RUNNING' })],
      recentSyncs: [],
      onFailure,
    });
    expect(onFailure).not.toHaveBeenCalled();

    rerender({
      activeSyncs: [],
      recentSyncs: [makeLog({ id: 'a', syncType: 'PRODUCTS', status: 'FAILED' })],
      onFailure,
    });

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[0].syncType).toBe('PRODUCTS');
  });

  it('does NOT fire on a FAILED_RETRYABLE (still active, run not dead)', () => {
    const onFailure = vi.fn();
    const { rerender } = renderToaster({
      activeSyncs: [makeLog({ id: 'a', syncType: 'ORDERS', status: 'RUNNING' })],
      recentSyncs: [],
      onFailure,
    });

    // A retryable failure stays in the active set — it never leaves, so no toast.
    rerender({
      activeSyncs: [makeLog({ id: 'a', syncType: 'ORDERS', status: 'FAILED_RETRYABLE' })],
      recentSyncs: [],
      onFailure,
    });

    expect(onFailure).not.toHaveBeenCalled();
  });

  it('does NOT fire when the flow completes successfully', () => {
    const onFailure = vi.fn();
    const { rerender } = renderToaster({
      activeSyncs: [makeLog({ id: 'a', syncType: 'ORDERS', status: 'RUNNING' })],
      recentSyncs: [],
      onFailure,
    });

    rerender({
      activeSyncs: [],
      recentSyncs: [makeLog({ id: 'a', syncType: 'ORDERS', status: 'COMPLETED' })],
      onFailure,
    });

    expect(onFailure).not.toHaveBeenCalled();
  });

  it('toasts at most once per run id even across a re-claim', () => {
    const onFailure = vi.fn();
    const { rerender } = renderToaster({
      activeSyncs: [makeLog({ id: 'a', syncType: 'CLAIMS', status: 'RUNNING' })],
      recentSyncs: [],
      onFailure,
    });

    // First terminal failure — one toast.
    rerender({
      activeSyncs: [],
      recentSyncs: [makeLog({ id: 'a', syncType: 'CLAIMS', status: 'FAILED' })],
      onFailure,
    });
    // Re-claimed (worker re-runs the same log), then fails again.
    rerender({
      activeSyncs: [makeLog({ id: 'a', syncType: 'CLAIMS', status: 'RUNNING' })],
      recentSyncs: [],
      onFailure,
    });
    rerender({
      activeSyncs: [],
      recentSyncs: [makeLog({ id: 'a', syncType: 'CLAIMS', status: 'FAILED' })],
      onFailure,
    });

    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('does not toast a failure belonging to another store', () => {
    const onFailure = vi.fn();
    const { rerender } = renderToaster({
      activeSyncs: [makeLog({ id: 'a', syncType: 'ORDERS', status: 'RUNNING' })],
      recentSyncs: [],
      onFailure,
    });

    rerender({
      activeSyncs: [],
      recentSyncs: [
        makeLog({ id: 'a', syncType: 'ORDERS', status: 'FAILED', storeId: OTHER_STORE }),
      ],
      onFailure,
    });

    expect(onFailure).not.toHaveBeenCalled();
  });

  it('does not fire on mount for a pre-existing FAILED row', () => {
    const onFailure = vi.fn();
    renderToaster({
      activeSyncs: [],
      recentSyncs: [makeLog({ id: 'old', syncType: 'ORDERS', status: 'FAILED' })],
      onFailure,
    });

    expect(onFailure).not.toHaveBeenCalled();
  });
});
