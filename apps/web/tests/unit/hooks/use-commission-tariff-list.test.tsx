import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useCommissionTariffList } from '@/features/campaigns/hooks/use-commission-tariff-list';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/commission-tariffs`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function listItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    name: '3 Günlük Fiyat',
    productCount: 12,
    selectedCount: 5,
    exported: false,
    validity: 'active',
    updatedAt: '2026-06-30T12:00:00Z',
    ...overrides,
  };
}

describe('useCommissionTariffList', () => {
  it('returns the store tariff list on success (unwraps data.data)', async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json(
          { data: [listItem(), listItem({ id: 'other', name: '7 Günlük Fiyat' })] },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useCommissionTariffList(ORG_ID, STORE_ID), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name).toBe('3 Günlük Fiyat');
    expect(result.current.data?.[0].selectedCount).toBe(5);
  });

  it('does not fetch when storeId is null (enabled=false path)', () => {
    const { result } = renderHook(() => useCommissionTariffList(ORG_ID, null), { wrapper });
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

    const { result } = renderHook(() => useCommissionTariffList(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
