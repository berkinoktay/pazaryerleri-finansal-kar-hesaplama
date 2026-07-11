import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { type SyncLog } from '@/features/sync/api/list-org-sync-logs.api';
import { orgSyncKeys } from '@/features/sync/query-keys';
import { useStartProductSync } from '@/features/products/hooks/use-start-product-sync';

import { HttpResponse, http, server } from '../../../helpers/msw';

// The shared createTestQueryClient sets `gcTime: 0` for determinism, which
// garbage-collects unobserved cache entries the moment a mutation finishes.
// This test asserts cache state without mounting a useQuery observer, so
// we need a non-zero gcTime to keep the optimistic row alive long enough
// to read it back.
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 60_000, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const SYNC_LOG_ID = '11111111-1111-1111-1111-111111111111';

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useStartProductSync', () => {
  it('writes an optimistic PENDING row to the cache on success', async () => {
    server.use(
      http.post(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/sync`,
        () =>
          HttpResponse.json(
            {
              syncLogId: SYNC_LOG_ID,
              status: 'PENDING' as const,
              enqueuedAt: '2026-04-28T10:00:00.000Z',
            },
            { status: 202 },
          ),
      ),
    );

    const queryClient = makeQueryClient();
    const queryKey = orgSyncKeys.list(ORG_ID);

    const { result } = renderHook(() => useStartProductSync(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(queryClient),
    });

    // No cache entry before the mutation runs.
    expect(queryClient.getQueryData<SyncLog[] | undefined>(queryKey)).toBeUndefined();

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryData<SyncLog[] | undefined>(queryKey);
    expect(cached).toBeDefined();
    expect(cached).toHaveLength(1);
    expect(cached?.[0]).toMatchObject({
      id: SYNC_LOG_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
      syncType: 'PRODUCTS',
      status: 'PENDING',
      startedAt: '2026-04-28T10:00:00.000Z',
      progressCurrent: 0,
      progressTotal: null,
      attemptCount: 0,
      nextAttemptAt: null,
    });
  });

  it('preserves existing rows and dedups against the new syncLogId', async () => {
    server.use(
      http.post(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/sync`,
        () =>
          HttpResponse.json(
            {
              syncLogId: SYNC_LOG_ID,
              status: 'PENDING' as const,
              enqueuedAt: '2026-04-28T10:00:00.000Z',
            },
            { status: 202 },
          ),
      ),
    );

    const queryClient = makeQueryClient();
    const queryKey = orgSyncKeys.list(ORG_ID);

    // Pre-seed: a stale completed row + a pre-existing optimistic row that
    // shares the new syncLogId (e.g. user double-clicked, or Realtime
    // beat the mutation's resolution path on a slow network). The dedup
    // by id keeps the cache at exactly one entry per syncLogId.
    const existingCompleted: SyncLog = {
      id: 'old-completed',
      organizationId: ORG_ID,
      storeId: STORE_ID,
      syncType: 'PRODUCTS',
      status: 'COMPLETED',
      startedAt: '2026-04-27T10:00:00.000Z',
      completedAt: '2026-04-27T10:05:00.000Z',
      recordsProcessed: 10,
      progressCurrent: 10,
      progressTotal: 10,
      progressStage: null,
      errorCode: null,
      errorMessage: null,
      attemptCount: 1,
      nextAttemptAt: null,
      skippedPages: null,
    };
    const racingDup: SyncLog = { ...existingCompleted, id: SYNC_LOG_ID, status: 'RUNNING' };
    queryClient.setQueryData<SyncLog[]>(queryKey, [existingCompleted, racingDup]);

    const { result } = renderHook(() => useStartProductSync(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(queryClient),
    });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryData<SyncLog[] | undefined>(queryKey);
    expect(cached).toHaveLength(2);
    expect(cached?.[0]?.id).toBe(SYNC_LOG_ID);
    expect(cached?.[0]?.status).toBe('PENDING'); // optimistic replaces the racing dup
    expect(cached?.[1]?.id).toBe('old-completed');
  });

  it('does nothing when orgId or storeId is null', () => {
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useStartProductSync(null, STORE_ID), {
      wrapper: makeWrapper(queryClient),
    });
    // Mutation throws synchronously when called, but the hook itself
    // shouldn't have attempted any cache write at render.
    expect(result.current.isIdle).toBe(true);
  });

  it('captures a cooldownUntil deadline from a 429 Retry-After response', async () => {
    server.use(
      http.post(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/sync`,
        () =>
          HttpResponse.json(
            {
              type: 'https://api.pazarsync.com/errors/rate-limited',
              title: 'Too many requests',
              status: 429,
              code: 'RATE_LIMITED',
              detail: 'Manual sync triggered before cooldown elapsed',
            },
            { status: 429, headers: { 'Retry-After': '300' } },
          ),
      ),
    );

    const queryClient = makeQueryClient();
    const before = Date.now();
    const { result } = renderHook(() => useStartProductSync(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(queryClient),
    });

    // No cooldown before the first attempt.
    expect(result.current.cooldownUntil).toBeNull();

    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));

    // The hook lifts the Retry-After (300s) into an absolute epoch-ms
    // deadline ~5 minutes out. Generous slack for test-runner timing.
    const cooldownUntil = result.current.cooldownUntil;
    expect(cooldownUntil).not.toBeNull();
    expect(cooldownUntil ?? 0).toBeGreaterThanOrEqual(before + 290_000);
    expect(cooldownUntil ?? 0).toBeLessThanOrEqual(Date.now() + 300_000);
  });

  it('leaves cooldownUntil null on a non-429 error (no Retry-After)', async () => {
    server.use(
      http.post(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/sync`,
        () =>
          HttpResponse.json(
            {
              type: 'https://api.pazarsync.com/errors/sync-in-progress',
              title: 'Sync already running',
              status: 409,
              code: 'SYNC_IN_PROGRESS',
              detail: 'A PRODUCTS sync is already running',
            },
            { status: 409 },
          ),
      ),
    );

    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useStartProductSync(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(queryClient),
    });

    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.cooldownUntil).toBeNull();
  });
});
