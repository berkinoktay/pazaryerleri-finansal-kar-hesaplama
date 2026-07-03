import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { usePlusTariffDetail } from '@/features/campaigns/hooks/use-plus-tariff-detail';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const TARIFF_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/plus-commission-tariffs/${TARIFF_ID}`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function scenario(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    price: '450.00',
    commissionPct: '18.00',
    netProfit: '42.00',
    marginPct: '10.50',
    ...overrides,
  };
}

function detailItem() {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    barcode: '8681234567890',
    stockCode: 'SKU-1',
    productTitle: 'Test Urun',
    imageUrl: 'https://cdn.example/urun.jpg',
    category: 'Kategori A',
    brand: 'Marka B',
    calculable: true,
    reason: null,
    current: scenario(),
    plus: scenario({ commissionPct: '14.00', netProfit: '58.00', marginPct: '14.20' }),
    plusIsBetter: true,
    selected: false,
    customPrice: null,
  };
}

function detailResponse() {
  return {
    id: TARIFF_ID,
    name: 'Plus 7 Gunluk',
    dateRangeLabel: '30 Haz - 6 Tem',
    validity: 'active',
    exported: false,
    items: [detailItem()],
  };
}

describe('usePlusTariffDetail', () => {
  it('returns the Plus tariff detail (items + scenarios) on success', async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(detailResponse(), { status: 200 })));

    const { result } = renderHook(() => usePlusTariffDetail(ORG_ID, STORE_ID, TARIFF_ID), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe(TARIFF_ID);
    expect(result.current.data?.dateRangeLabel).toBe('30 Haz - 6 Tem');
    expect(result.current.data?.items).toHaveLength(1);
    expect(result.current.data?.items[0].plusIsBetter).toBe(true);
    expect(result.current.data?.items[0].current.netProfit).toBe('42.00');
    expect(result.current.data?.items[0].plus.netProfit).toBe('58.00');
  });

  it('does not fetch when tariffId is null (enabled=false path)', () => {
    const { result } = renderHook(() => usePlusTariffDetail(ORG_ID, STORE_ID, null), {
      wrapper,
    });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('does not fetch when storeId is null (enabled=false path)', () => {
    const { result } = renderHook(() => usePlusTariffDetail(ORG_ID, null, TARIFF_ID), {
      wrapper,
    });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });
});
