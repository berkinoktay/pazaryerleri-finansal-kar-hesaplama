import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncLog } from '@/features/sync/api/list-org-sync-logs.api';
import { useStoreSyncs } from '@/features/sync/hooks/use-store-syncs';

// Mock the provider module — useStoreSyncs is a pure derivation over
// useOrgSyncs(), so we only need to control what the context returns.
const mockUseOrgSyncs = vi.fn();
vi.mock('@/features/sync/providers/org-syncs-provider', () => ({
  useOrgSyncs: () => mockUseOrgSyncs(),
}));

const STORE_A = '00000000-0000-0000-0000-0000000000aa';
const STORE_B = '00000000-0000-0000-0000-0000000000bb';

interface MakeLogOverrides {
  id?: string;
  storeId?: string;
  status?: SyncLog['status'];
  startedAt?: string;
}

function makeLog(overrides: MakeLogOverrides = {}): SyncLog {
  return {
    id: overrides.id ?? 'log-1',
    storeId: overrides.storeId ?? STORE_A,
    syncType: 'PRODUCTS',
    status: overrides.status ?? 'RUNNING',
    startedAt: overrides.startedAt ?? '2026-04-27T12:00:00Z',
    completedAt: null,
    recordsProcessed: 0,
    progressCurrent: 100,
    progressTotal: 500,
    progressStage: 'upserting',
    errorCode: null,
    errorMessage: null,
    attemptCount: 1,
    nextAttemptAt: null,
  };
}

beforeEach(() => {
  mockUseOrgSyncs.mockReset();
});

describe('useStoreSyncs', () => {
  it('returns empty arrays when storeId is null', () => {
    mockUseOrgSyncs.mockReturnValue({
      activeSyncs: [makeLog({ id: 'a', storeId: STORE_A })],
      recentSyncs: [makeLog({ id: 'b', storeId: STORE_A, status: 'COMPLETED' })],
      isLoading: false,
    });

    const { result } = renderHook(() => useStoreSyncs(null));
    expect(result.current.activeSyncs).toEqual([]);
    expect(result.current.recentSyncs).toEqual([]);
  });

  it('returns empty arrays when storeId is an empty string', () => {
    mockUseOrgSyncs.mockReturnValue({
      activeSyncs: [makeLog({ id: 'a', storeId: STORE_A })],
      recentSyncs: [],
      isLoading: false,
    });

    const { result } = renderHook(() => useStoreSyncs(''));
    expect(result.current.activeSyncs).toEqual([]);
    expect(result.current.recentSyncs).toEqual([]);
  });

  it('filters activeSyncs to the matching storeId', () => {
    mockUseOrgSyncs.mockReturnValue({
      activeSyncs: [
        makeLog({ id: 'a-running', storeId: STORE_A }),
        makeLog({ id: 'b-running', storeId: STORE_B }),
      ],
      recentSyncs: [],
      isLoading: false,
    });

    const { result } = renderHook(() => useStoreSyncs(STORE_A));
    expect(result.current.activeSyncs).toHaveLength(1);
    expect(result.current.activeSyncs[0]?.id).toBe('a-running');
  });

  it('filters recentSyncs to the matching storeId', () => {
    mockUseOrgSyncs.mockReturnValue({
      activeSyncs: [],
      recentSyncs: [
        makeLog({ id: 'a-done', storeId: STORE_A, status: 'COMPLETED' }),
        makeLog({ id: 'b-done', storeId: STORE_B, status: 'COMPLETED' }),
        makeLog({ id: 'a-fail', storeId: STORE_A, status: 'FAILED' }),
      ],
      isLoading: false,
    });

    const { result } = renderHook(() => useStoreSyncs(STORE_A));
    expect(result.current.recentSyncs).toHaveLength(2);
    expect(result.current.recentSyncs.map((s) => s.id)).toEqual(['a-done', 'a-fail']);
  });

  it('returns empty arrays when no rows match the storeId', () => {
    mockUseOrgSyncs.mockReturnValue({
      activeSyncs: [makeLog({ id: 'b-running', storeId: STORE_B })],
      recentSyncs: [makeLog({ id: 'b-done', storeId: STORE_B, status: 'COMPLETED' })],
      isLoading: false,
    });

    const { result } = renderHook(() => useStoreSyncs(STORE_A));
    expect(result.current.activeSyncs).toEqual([]);
    expect(result.current.recentSyncs).toEqual([]);
  });

  it('memoizes derivation — same input refs yield the same output ref', () => {
    const activeSyncs = [makeLog({ id: 'a-running', storeId: STORE_A })];
    const recentSyncs = [makeLog({ id: 'a-done', storeId: STORE_A, status: 'COMPLETED' })];
    mockUseOrgSyncs.mockReturnValue({ activeSyncs, recentSyncs, isLoading: false });

    const { result, rerender } = renderHook(() => useStoreSyncs(STORE_A));
    const first = result.current;
    rerender();
    const second = result.current;

    expect(second).toBe(first);
    expect(second.activeSyncs).toBe(first.activeSyncs);
    expect(second.recentSyncs).toBe(first.recentSyncs);
  });
});
