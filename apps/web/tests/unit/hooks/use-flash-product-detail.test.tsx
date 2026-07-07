import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useFlashProductDetail } from '@/features/campaigns/hooks/use-flash-product-detail';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/flash-products/${LIST_ID}`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function offer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    price: '600.00',
    startsAt: '2026-07-08T00:00:00Z',
    endsAt: '2026-07-08T23:59:00Z',
    validity: 'active',
    commissionPct: '13.10',
    netProfit: '30.00',
    marginPct: '10.00',
    ...overrides,
  };
}

function detailItem() {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    barcode: '8681234567890',
    modelCode: 'MODEL-1',
    productTitle: 'Test Ürün',
    imageUrl: 'https://cdn.example/urun.jpg',
    category: 'Kategori A',
    brand: 'Marka B',
    stock: 12,
    externalId: 'ext-1',
    currentPrice: '800.00',
    customerPrice: '800.00',
    currentCommissionPct: '19.00',
    currentNetProfit: '50.00',
    currentMarginPct: '6.25',
    calculable: true,
    reason: null,
    hasCommissionTariff: true,
    commissionSource: 'band',
    commissionBands: null,
    offer24: offer({ price: '600.00', netProfit: '30.00' }),
    offer3: offer({ price: '650.00', netProfit: '20.00', validity: 'upcoming' }),
    selectedOffer: 'H24',
    customPrice: null,
  };
}

function detailResponse() {
  return {
    id: LIST_ID,
    name: 'Temmuz Flaş Ürünleri',
    exported: false,
    items: [detailItem()],
  };
}

describe('useFlashProductDetail', () => {
  it('returns the Flash Products detail (offer rows + per-scenario profit) on success', async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(detailResponse(), { status: 200 })));

    const { result } = renderHook(() => useFlashProductDetail(ORG_ID, STORE_ID, LIST_ID), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe(LIST_ID);
    expect(result.current.data?.items).toHaveLength(1);
    const item = result.current.data?.items[0];
    expect(item?.selectedOffer).toBe('H24');
    expect(item?.currentNetProfit).toBe('50.00');
    expect(item?.offer24?.netProfit).toBe('30.00');
    expect(item?.offer3?.validity).toBe('upcoming');
  });

  it('does not fetch when listId is null (enabled=false path)', () => {
    const { result } = renderHook(() => useFlashProductDetail(ORG_ID, STORE_ID, null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('does not fetch when storeId is null (enabled=false path)', () => {
    const { result } = renderHook(() => useFlashProductDetail(ORG_ID, null, LIST_ID), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });
});
