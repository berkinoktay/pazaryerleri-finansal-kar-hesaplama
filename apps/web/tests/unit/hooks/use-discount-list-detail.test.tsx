import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useDiscountListDetail } from '@/features/campaigns/hooks/use-discount-list-detail';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/discount-lists/${LIST_ID}`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function scenario(netProfit: string | null) {
  return {
    price: '100.00',
    commissionPct: '20.00',
    commissionSource: 'band',
    netProfit,
    marginPct: netProfit,
  };
}

function detailItem() {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    barcode: '8681234567890',
    modelCode: 'MODEL-1',
    externalId: 'ext-1',
    productTitle: 'Test Ürün',
    brand: 'Marka B',
    color: 'Siyah',
    imageUrl: 'https://cdn.example/urun.jpg',
    included: true,
    calculable: true,
    reason: null,
    current: scenario('25.00'),
    discounted: scenario('10.00'),
  };
}

function detailResponse() {
  return {
    id: LIST_ID,
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
    exported: false,
    items: [detailItem()],
  };
}

describe('useDiscountListDetail', () => {
  it('returns the discount list detail (items + per-scenario profit) on success', async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(detailResponse(), { status: 200 })));

    const { result } = renderHook(() => useDiscountListDetail(ORG_ID, STORE_ID, LIST_ID), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe(LIST_ID);
    expect(result.current.data?.items).toHaveLength(1);
    const item = result.current.data?.items[0];
    expect(item?.current.netProfit).toBe('25.00');
    expect(item?.discounted.netProfit).toBe('10.00');
  });

  it('does not fetch when listId is null (enabled=false path)', () => {
    const { result } = renderHook(() => useDiscountListDetail(ORG_ID, STORE_ID, null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('does not fetch when storeId is null (enabled=false path)', () => {
    const { result } = renderHook(() => useDiscountListDetail(ORG_ID, null, LIST_ID), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('surfaces an error when the request fails', async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Not found',
            status: 404,
            code: 'NOT_FOUND',
            detail: 'list missing',
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(() => useDiscountListDetail(ORG_ID, STORE_ID, LIST_ID), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
