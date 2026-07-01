import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useCommissionTariffDetail } from '@/features/campaigns/hooks/use-commission-tariff-detail';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const TARIFF_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/commission-tariffs/${TARIFF_ID}`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function band(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    key: 'band1',
    lowerLimit: '450.00',
    upperLimit: null,
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
    productTitle: 'Test Ürün',
    category: 'Kategori A',
    brand: 'Marka B',
    currentPrice: '450.00',
    currentCommissionPct: '18.00',
    calculable: true,
    reason: null,
    bestBandKey: 'band1',
    selectedBand: null,
    customPrice: null,
    bands: [band(), band({ key: 'band2', upperLimit: '449.99', price: '400.00' })],
  };
}

function detailResponse() {
  return {
    id: TARIFF_ID,
    name: '3 Günlük Fiyat',
    exported: false,
    periods: [
      {
        id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        dateRangeLabel: '30 Haz - 2 Tem',
        validity: 'active',
        items: [detailItem()],
      },
    ],
  };
}

describe('useCommissionTariffDetail', () => {
  it('returns the tariff detail (periods + bands) on success', async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(detailResponse(), { status: 200 })));

    const { result } = renderHook(() => useCommissionTariffDetail(ORG_ID, STORE_ID, TARIFF_ID), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe(TARIFF_ID);
    expect(result.current.data?.periods).toHaveLength(1);
    expect(result.current.data?.periods[0].items[0].bands[0].netProfit).toBe('42.00');
  });

  it('does not fetch when tariffId is null (enabled=false path)', () => {
    const { result } = renderHook(() => useCommissionTariffDetail(ORG_ID, STORE_ID, null), {
      wrapper,
    });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('does not fetch when storeId is null (enabled=false path)', () => {
    const { result } = renderHook(() => useCommissionTariffDetail(ORG_ID, null, TARIFF_ID), {
      wrapper,
    });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });
});
