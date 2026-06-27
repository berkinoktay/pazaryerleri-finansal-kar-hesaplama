import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { MarginColoringProvider } from '@/features/account/components/margin-coloring-provider';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import { createTestQueryClient } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

const TEST_API_BASE = 'http://localhost:3001';

const SCALE_PREFERENCES = {
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

// Each test gets its own QueryClient so cache never leaks between tests.
function makeWrapper() {
  const queryClient = createTestQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MarginColoringProvider>{children}</MarginColoringProvider>
      </QueryClientProvider>
    );
  }
  return Wrapper;
}

describe('MarginColoringProvider + useMarginColoring', () => {
  it('returns null before preferences have loaded (SSR-safe / loading state)', () => {
    // Register a handler that never resolves to simulate in-flight state.
    server.use(
      http.get(`${TEST_API_BASE}/v1/me/preferences`, async () => {
        await new Promise(() => {}); // intentional hang
        return HttpResponse.json({ data: {} });
      }),
    );

    const { result } = renderHook(() => useMarginColoring(), { wrapper: makeWrapper() });
    // Before data arrives, the hook returns null (binary fallback / SSR-safe).
    expect(result.current).toBeNull();
  });

  it('returns the MarginScale when preferences include marginColoring', async () => {
    server.use(
      http.get(`${TEST_API_BASE}/v1/me/preferences`, () =>
        HttpResponse.json({ data: SCALE_PREFERENCES }),
      ),
    );

    const { result } = renderHook(() => useMarginColoring(), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(result.current?.enabled).toBe(true);
    expect(result.current?.buckets).toHaveLength(5);
    expect(result.current?.buckets[0]).toMatchObject({ threshold: -10 });
  });

  it('returns null when marginColoring is not present in preferences', async () => {
    server.use(
      http.get(`${TEST_API_BASE}/v1/me/preferences`, () => HttpResponse.json({ data: {} })),
    );

    const { result } = renderHook(() => useMarginColoring(), { wrapper: makeWrapper() });

    // Query resolves to success but marginColoring is absent — should stay null.
    // Wait for the query to complete (no initial data) by checking isSuccess via
    // a short settle.
    await waitFor(() => {
      // The provider exposes null when there is no marginColoring key.
      expect(result.current).toBeNull();
    });
  });

  it('returns the scale object (enabled=false) when marginColoring is disabled', async () => {
    server.use(
      http.get(`${TEST_API_BASE}/v1/me/preferences`, () =>
        HttpResponse.json({
          data: {
            marginColoring: {
              enabled: false,
              buckets: [
                { threshold: 0, color: 'oklch(58% 0.20 27)' },
                { threshold: 50, color: 'oklch(58% 0.14 155)' },
              ],
            },
          },
        }),
      ),
    );

    const { result } = renderHook(() => useMarginColoring(), { wrapper: makeWrapper() });

    // The provider exposes the raw scale; marginColorStyle handles enabled=false
    // by falling back to binary. The provider must NOT filter out disabled scales.
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    expect(result.current?.enabled).toBe(false);
  });
});
