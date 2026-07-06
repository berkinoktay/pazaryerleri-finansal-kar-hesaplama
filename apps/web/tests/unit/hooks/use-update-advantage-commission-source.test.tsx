import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useUpdateAdvantageCommissionSource } from '@/features/campaigns/hooks/use-update-advantage-commission-source';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const TARIFF_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SOURCE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/advantage-tariffs/${TARIFF_ID}/commission-source`;

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useUpdateAdvantageCommissionSource', () => {
  it('PATCHes the pinned commission tariff and resolves with the resolved id', async () => {
    let capturedBody: unknown;
    server.use(
      http.patch(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ commissionSourceTariffId: SOURCE_ID }, { status: 200 });
      }),
    );

    const { result } = renderHook(
      () => useUpdateAdvantageCommissionSource(ORG_ID, STORE_ID, TARIFF_ID),
      { wrapper: makeWrapper(createTestQueryClient()) },
    );
    result.current.mutate({ commissionSourceTariffId: SOURCE_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({ commissionSourceTariffId: SOURCE_ID });
    expect(result.current.data?.commissionSourceTariffId).toBe(SOURCE_ID);
  });

  it('clears the pin (null → automatic/active period) and round-trips the null id', async () => {
    let capturedBody: unknown;
    server.use(
      http.patch(ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ commissionSourceTariffId: null }, { status: 200 });
      }),
    );

    const { result } = renderHook(
      () => useUpdateAdvantageCommissionSource(ORG_ID, STORE_ID, TARIFF_ID),
      { wrapper: makeWrapper(createTestQueryClient()) },
    );
    result.current.mutate({ commissionSourceTariffId: null });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({ commissionSourceTariffId: null });
    expect(result.current.data?.commissionSourceTariffId).toBeNull();
  });

  it('invalidates that tariff detail on success so every tier profit recomputes', async () => {
    server.use(
      http.patch(ENDPOINT, () =>
        HttpResponse.json({ commissionSourceTariffId: SOURCE_ID }, { status: 200 }),
      ),
    );

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(
      () => useUpdateAdvantageCommissionSource(ORG_ID, STORE_ID, TARIFF_ID),
      { wrapper: makeWrapper(client) },
    );
    result.current.mutate({ commissionSourceTariffId: SOURCE_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['advantage-tariffs', 'detail', ORG_ID, STORE_ID, TARIFF_ID],
    });
  });

  it('throws an ApiError when the pinned tariff is not found (404)', async () => {
    server.use(
      http.patch(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Not found',
            status: 404,
            code: 'NOT_FOUND',
            detail: 'commission tariff missing',
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(
      () => useUpdateAdvantageCommissionSource(ORG_ID, STORE_ID, TARIFF_ID),
      { wrapper: makeWrapper(createTestQueryClient()) },
    );
    result.current.mutate({ commissionSourceTariffId: SOURCE_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
