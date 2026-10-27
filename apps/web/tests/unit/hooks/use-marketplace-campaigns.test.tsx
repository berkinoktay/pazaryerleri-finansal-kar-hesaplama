import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useMarketplaceCampaigns } from '@/features/campaigns/hooks/use-marketplace-campaigns';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/marketplace-campaigns`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function listItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    name: 'Ağustos Sepet Kampanyası',
    discountType: 'CONDITIONAL_BASKET',
    valueKind: 'AMOUNT',
    value: '100',
    minBasketAmount: '1000',
    minQuantity: null,
    buyQuantity: null,
    payQuantity: null,
    nthIndex: null,
    trendyolFundingPct: '60',
    startsAt: '2026-08-01T07:00:00.000Z',
    endsAt: '2026-08-07T20:59:59.000Z',
    itemCount: 68,
    selectedCount: 12,
    exported: false,
    updatedAt: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

describe('useMarketplaceCampaigns', () => {
  it('returns the store campaigns on success (unwraps data.data)', async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json(
          { data: [listItem(), listItem({ id: 'other', name: 'Eylül Net İndirim' })] },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useMarketplaceCampaigns(ORG_ID, STORE_ID), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name).toBe('Ağustos Sepet Kampanyası');
    expect(result.current.data?.[0].trendyolFundingPct).toBe('60');
    expect(result.current.data?.[0].selectedCount).toBe(12);
    expect(result.current.data?.[0].itemCount).toBe(68);
  });

  it('does not fire a request when storeId is null (enabled=false path)', async () => {
    const hits = vi.fn();
    server.use(
      http.get(ENDPOINT, () => {
        hits();
        return HttpResponse.json({ data: [] }, { status: 200 });
      }),
    );

    const { result } = renderHook(() => useMarketplaceCampaigns(ORG_ID, null), { wrapper });

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

    const { result } = renderHook(() => useMarketplaceCampaigns(ORG_ID, STORE_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
