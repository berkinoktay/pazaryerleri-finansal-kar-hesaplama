import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useAdvantageTariffDetail } from '@/features/campaigns/hooks/use-advantage-tariff-detail';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const TARIFF_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/advantage-tariffs/${TARIFF_ID}`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
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
    size: 'M',
    stock: 12,
    currentPrice: '150.00',
    customerPrice: '120.00',
    hasCommissionTariff: true,
    calculable: true,
    reason: null,
    current: { commissionPct: '19.00', netProfit: '10.00', marginPct: '8.00', isBest: false },
    tiers: [
      {
        key: 'tier1',
        upperLimit: '110.00',
        lowerLimit: null,
        price: '110.00',
        commissionPct: '15.40',
        commissionSource: 'band',
        netProfit: '20.00',
        marginPct: '11.00',
      },
      {
        key: 'tier2',
        upperLimit: '100.00',
        lowerLimit: null,
        price: '100.00',
        commissionPct: '14.00',
        commissionSource: 'band',
        netProfit: '40.00',
        marginPct: '18.00',
      },
    ],
    bestTierKey: 'tier2',
    selectedTier: 'tier2',
    customPrice: null,
  };
}

function detailResponse() {
  return {
    id: TARIFF_ID,
    name: 'Avantajli Urun Etiketleri',
    exported: false,
    commissionSourceMode: 'pinned',
    commissionSource: {
      tariffId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      tariffName: 'Temmuz Komisyon',
      periodLabel: '30 Haz - 6 Tem',
      startsAt: '2026-06-30T00:00:00Z',
      endsAt: '2026-07-06T00:00:00Z',
    },
    hasUnmatchedCommissionProducts: false,
    items: [detailItem()],
  };
}

describe('useAdvantageTariffDetail', () => {
  it('returns the Advantage tariff detail (items + scenarios + commission source) on success', async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(detailResponse(), { status: 200 })));

    const { result } = renderHook(() => useAdvantageTariffDetail(ORG_ID, STORE_ID, TARIFF_ID), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe(TARIFF_ID);
    expect(result.current.data?.commissionSourceMode).toBe('pinned');
    expect(result.current.data?.items).toHaveLength(1);
    const item = result.current.data?.items[0];
    expect(item?.selectedTier).toBe('tier2');
    expect(item?.current.netProfit).toBe('10.00');
    expect(item?.tiers).toHaveLength(2);
    expect(item?.tiers[1].netProfit).toBe('40.00');
  });

  it('does not fetch when tariffId is null (enabled=false path)', () => {
    const { result } = renderHook(() => useAdvantageTariffDetail(ORG_ID, STORE_ID, null), {
      wrapper,
    });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('does not fetch when storeId is null (enabled=false path)', () => {
    const { result } = renderHook(() => useAdvantageTariffDetail(ORG_ID, null, TARIFF_ID), {
      wrapper,
    });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });
});
