import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useStoreProfitSettings } from '@/features/profit-settings/hooks/use-store-profit-settings';
import { useUpdateStoreProfitSettings } from '@/features/profit-settings/hooks/use-update-store-profit-settings';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/profit-settings`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useStoreProfitSettings', () => {
  it('fetches the resolved settings for a store', async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json({ includeStopaj: true, includeNegativeNetVat: false }, { status: 200 }),
      ),
    );

    const { result } = renderHook(() => useStoreProfitSettings(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({ includeStopaj: true, includeNegativeNetVat: false });
  });

  it('stays idle (disabled) while the store id is null', () => {
    const { result } = renderHook(() => useStoreProfitSettings(ORG_ID, null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useUpdateStoreProfitSettings', () => {
  it('PATCHes only the provided keys and returns the resolved settings', async () => {
    let capturedBody: unknown;
    server.use(
      http.patch(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          { includeStopaj: true, includeNegativeNetVat: true },
          { status: 200 },
        );
      }),
    );

    const { result } = renderHook(() => useUpdateStoreProfitSettings(ORG_ID, STORE_ID), {
      wrapper,
    });
    result.current.mutate({ includeNegativeNetVat: true });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(capturedBody).toEqual({ includeNegativeNetVat: true });
    expect(result.current.data).toEqual({ includeStopaj: true, includeNegativeNetVat: true });
  });
});
