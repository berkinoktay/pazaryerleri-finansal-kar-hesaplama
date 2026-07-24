import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useDiscountLists } from '@/features/campaigns/hooks/use-discount-lists';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/discount-lists`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function listItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    name: 'Temmuz İndirimleri',
    discountType: 'NET',
    valueKind: 'PERCENT',
    value: '20',
    minBasketAmount: null,
    minQuantity: null,
    buyQuantity: null,
    payQuantity: null,
    nthIndex: null,
    startsAt: null,
    endsAt: null,
    itemCount: 30,
    selectedCount: 5,
    exported: false,
    updatedAt: '2026-06-30T12:00:00Z',
    ...overrides,
  };
}

describe('useDiscountLists', () => {
  it('returns the store discount lists on success (unwraps data.data)', async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json(
          { data: [listItem(), listItem({ id: 'other', name: 'Ağustos İndirimleri' })] },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useDiscountLists(ORG_ID, STORE_ID), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name).toBe('Temmuz İndirimleri');
    expect(result.current.data?.[0].selectedCount).toBe(5);
    expect(result.current.data?.[0].itemCount).toBe(30);
  });

  it('does not fire a request when storeId is null (enabled=false path)', async () => {
    const hits = vi.fn();
    server.use(
      http.get(ENDPOINT, () => {
        hits();
        return HttpResponse.json({ data: [] }, { status: 200 });
      }),
    );

    const { result } = renderHook(() => useDiscountLists(ORG_ID, null), { wrapper });

    // A disabled query never leaves the pending/idle state and never touches the network.
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
    // Give any (erroneously) scheduled fetch a tick to fire, then assert it never did.
    await Promise.resolve();
    expect(hits).not.toHaveBeenCalled();
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

    const { result } = renderHook(() => useDiscountLists(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
