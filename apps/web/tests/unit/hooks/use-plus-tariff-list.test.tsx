import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { usePlusTariffList } from '@/features/campaigns/hooks/use-plus-tariff-list';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/plus-commission-tariffs`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function listItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    name: 'Plus 7 Gunluk',
    productCount: 12,
    selectedCount: 5,
    exported: false,
    validity: 'active',
    updatedAt: '2026-06-30T12:00:00Z',
    ...overrides,
  };
}

describe('usePlusTariffList', () => {
  it('returns the store Plus tariff list on success (unwraps data.data)', async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json(
          { data: [listItem(), listItem({ id: 'other', name: 'Plus Yaz Kampanyasi' })] },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => usePlusTariffList(ORG_ID, STORE_ID), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name).toBe('Plus 7 Gunluk');
    expect(result.current.data?.[0].selectedCount).toBe(5);
  });

  it('does not fetch when storeId is null (enabled=false path)', () => {
    const { result } = renderHook(() => usePlusTariffList(ORG_ID, null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('surfaces an error when the request fails', async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Internal error',
            status: 500,
            code: 'INTERNAL_ERROR',
            detail: 'boom',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(() => usePlusTariffList(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
