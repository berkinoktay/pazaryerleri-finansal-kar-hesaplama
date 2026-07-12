import type { SyncType } from '@pazarsync/db/enums';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SyncLog } from '@/features/sync/api/list-org-sync-logs.api';
import { useFlowsSettled } from '@/features/sync/hooks/use-flows-settled';

const STORE = 'store-1';
const PAGE_TYPES: ReadonlySet<SyncType> = new Set<SyncType>(['ORDERS']);

function makeLog(
  overrides: Partial<SyncLog> & Pick<SyncLog, 'id' | 'syncType' | 'status'>,
): SyncLog {
  return {
    organizationId: 'org-1',
    storeId: STORE,
    startedAt: '2026-07-11T11:00:00.000Z',
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
  onFlowsSettled: () => void;
}

function renderFlowsSettled(initial: Props) {
  return renderHook(
    (props: Props) =>
      useFlowsSettled({
        storeId: STORE,
        pageSourceTypes: PAGE_TYPES,
        activeSyncs: props.activeSyncs,
        recentSyncs: props.recentSyncs,
        onFlowsSettled: props.onFlowsSettled,
      }),
    { initialProps: initial },
  );
}

describe('useFlowsSettled', () => {
  it('fires once when a watched active flow leaves the active set as COMPLETED', () => {
    const onFlowsSettled = vi.fn();
    const active = makeLog({ id: 'a', syncType: 'ORDERS', status: 'RUNNING' });

    const { rerender } = renderFlowsSettled({
      activeSyncs: [active],
      recentSyncs: [],
      onFlowsSettled,
    });
    expect(onFlowsSettled).not.toHaveBeenCalled();

    // The flow completes: it moves out of activeSyncs into recentSyncs.
    rerender({
      activeSyncs: [],
      recentSyncs: [makeLog({ id: 'a', syncType: 'ORDERS', status: 'COMPLETED' })],
      onFlowsSettled,
    });

    expect(onFlowsSettled).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when the flow exits as FAILED', () => {
    const onFlowsSettled = vi.fn();

    const { rerender } = renderFlowsSettled({
      activeSyncs: [makeLog({ id: 'a', syncType: 'ORDERS', status: 'RUNNING' })],
      recentSyncs: [],
      onFlowsSettled,
    });

    rerender({
      activeSyncs: [],
      recentSyncs: [makeLog({ id: 'a', syncType: 'ORDERS', status: 'FAILED' })],
      onFlowsSettled,
    });

    expect(onFlowsSettled).not.toHaveBeenCalled();
  });

  it('collapses several flows finishing in the same commit into a single call', () => {
    const onFlowsSettled = vi.fn();

    const { rerender } = renderFlowsSettled({
      activeSyncs: [
        makeLog({ id: 'a', syncType: 'ORDERS', status: 'RUNNING' }),
        makeLog({ id: 'b', syncType: 'ORDERS', status: 'PENDING' }),
      ],
      recentSyncs: [],
      onFlowsSettled,
    });

    rerender({
      activeSyncs: [],
      recentSyncs: [
        makeLog({ id: 'a', syncType: 'ORDERS', status: 'COMPLETED' }),
        makeLog({ id: 'b', syncType: 'ORDERS', status: 'COMPLETED' }),
      ],
      onFlowsSettled,
    });

    expect(onFlowsSettled).toHaveBeenCalledTimes(1);
  });

  it('ignores flows for sync types the page does not source', () => {
    const onFlowsSettled = vi.fn();

    const { rerender } = renderFlowsSettled({
      // SETTLEMENTS is not in PAGE_TYPES, so it never counts as a watched flow.
      activeSyncs: [makeLog({ id: 'a', syncType: 'SETTLEMENTS', status: 'RUNNING' })],
      recentSyncs: [],
      onFlowsSettled,
    });

    rerender({
      activeSyncs: [],
      recentSyncs: [makeLog({ id: 'a', syncType: 'SETTLEMENTS', status: 'COMPLETED' })],
      onFlowsSettled,
    });

    expect(onFlowsSettled).not.toHaveBeenCalled();
  });
});
