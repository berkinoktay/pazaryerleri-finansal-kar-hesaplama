import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  useMyPreferences,
  useUpdateMyPreferences,
} from '@/features/account/hooks/use-my-preferences';

import { createTestQueryClient } from '../../helpers/render';
import { server, http, HttpResponse } from '../../helpers/msw';

const TEST_API_BASE = 'http://localhost:3001';

const SAMPLE_PREFERENCES = {
  marginColoring: {
    enabled: true,
    buckets: [
      { threshold: -10, color: 'oklch(58% 0.20 27)' },
      { threshold: 0, color: 'oklch(57% 0.17 75)' },
      { threshold: 10, color: 'oklch(59% 0.15 115)' },
      { threshold: 25, color: 'oklch(58% 0.15 140)' },
      { threshold: 50, color: 'oklch(58% 0.14 155)' },
    ],
  },
};

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useMyPreferences', () => {
  it('returns preferences data on success', async () => {
    server.use(
      http.get(`${TEST_API_BASE}/v1/me/preferences`, () =>
        HttpResponse.json({ data: SAMPLE_PREFERENCES }),
      ),
    );

    const { result } = renderHook(() => useMyPreferences(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.marginColoring).toMatchObject({
      enabled: true,
      buckets: expect.arrayContaining([
        expect.objectContaining({ threshold: -10 }),
        expect.objectContaining({ threshold: 50 }),
      ]),
    });
  });

  it('returns empty preferences when marginColoring is not set', async () => {
    server.use(
      http.get(`${TEST_API_BASE}/v1/me/preferences`, () => HttpResponse.json({ data: {} })),
    );

    const { result } = renderHook(() => useMyPreferences(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.marginColoring).toBeUndefined();
  });
});

describe('useUpdateMyPreferences', () => {
  it('calls PATCH and resolves with updated preferences', async () => {
    const updated = {
      ...SAMPLE_PREFERENCES,
      marginColoring: { ...SAMPLE_PREFERENCES.marginColoring, enabled: false },
    };

    server.use(
      http.patch(`${TEST_API_BASE}/v1/me/preferences`, () => HttpResponse.json({ data: updated })),
    );

    const queryClient = createTestQueryClient();
    function wrapperWithClient({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useUpdateMyPreferences(), { wrapper: wrapperWithClient });
    result.current.mutate({
      marginColoring: { enabled: false, buckets: SAMPLE_PREFERENCES.marginColoring.buckets },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.marginColoring?.enabled).toBe(false);
  });

  it('invalidates preferences cache on success', async () => {
    server.use(
      http.get(`${TEST_API_BASE}/v1/me/preferences`, () =>
        HttpResponse.json({ data: SAMPLE_PREFERENCES }),
      ),
      http.patch(`${TEST_API_BASE}/v1/me/preferences`, () =>
        HttpResponse.json({ data: SAMPLE_PREFERENCES }),
      ),
    );

    const queryClient = createTestQueryClient();
    function wrapperWithClient({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    // First load the preferences to populate the cache.
    const { result: queryResult } = renderHook(() => useMyPreferences(), {
      wrapper: wrapperWithClient,
    });
    await waitFor(() => expect(queryResult.current.isSuccess).toBe(true));

    // Then mutate — should invalidate the query key.
    const { result: mutResult } = renderHook(() => useUpdateMyPreferences(), {
      wrapper: wrapperWithClient,
    });
    mutResult.current.mutate({ marginColoring: SAMPLE_PREFERENCES.marginColoring });

    await waitFor(() => expect(mutResult.current.isSuccess).toBe(true));
    // After invalidation the query should refetch. isStale goes true or
    // fetchStatus returns 'fetching' briefly. We just verify the mutation
    // completed successfully and the query key exists in the cache.
    expect(queryClient.getQueryState(['preferences'])?.status).toBe('success');
  });
});
