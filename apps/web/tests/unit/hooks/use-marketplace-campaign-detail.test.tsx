import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { adaptMarketplaceCampaignDetail } from '@/features/campaigns/lib/adapt-marketplace-campaign';
import { useMarketplaceCampaignDetail } from '@/features/campaigns/hooks/use-marketplace-campaign-detail';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const CAMPAIGN_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/marketplace-campaigns/${CAMPAIGN_ID}`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function scenario(price: string, netProfit: string) {
  return {
    price,
    commissionPct: '20.00',
    commissionSource: 'band',
    netProfit,
    marginPct: netProfit,
  };
}

/** Item with NO saved custom price — the common state on a freshly-imported campaign. */
function noCustomPriceItem() {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    barcode: '8681234567890',
    productCode: 'MODEL-1',
    externalId: 'ext-1',
    productTitle: 'Kampanyasız Ürün',
    brand: 'Marka B',
    color: 'Siyah',
    size: 'M',
    category: 'Giyim',
    stock: 10,
    imageUrl: 'https://cdn.example/urun-1.jpg',
    currentPrice: '100.00',
    maxPrice: '80.00',
    hasCommissionTariff: true,
    selection: 'NONE',
    customPrice: null,
    calculable: true,
    reason: null,
    current: scenario('100.00', '25.00'),
    maxScenario: scenario('80.00', '10.00'),
    customScenario: null,
    commissionBands: null,
    maxBasket: null,
    customBasket: null,
  };
}

/** Item WITH a saved custom price — proves customScenario carries through when present. */
function customPriceItem() {
  return {
    id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
    barcode: '8681234567891',
    productCode: 'MODEL-2',
    externalId: 'ext-2',
    productTitle: 'Özel Fiyatlı Ürün',
    brand: 'Marka C',
    color: 'Beyaz',
    size: 'L',
    category: 'Giyim',
    stock: 4,
    imageUrl: 'https://cdn.example/urun-2.jpg',
    currentPrice: '200.00',
    maxPrice: '150.00',
    hasCommissionTariff: true,
    selection: 'CUSTOM',
    customPrice: '120.00',
    calculable: true,
    reason: null,
    current: scenario('200.00', '60.00'),
    maxScenario: scenario('150.00', '30.00'),
    customScenario: scenario('120.00', '15.00'),
    commissionBands: null,
    maxBasket: null,
    customBasket: null,
  };
}

/** The assumed-basket block an ORDER-presentation option carries. */
function basket(n: number, basketTotal: string, orderNetProfit: string) {
  return {
    assumedQuantity: n,
    basketTotal,
    basketPaidTotal: basketTotal,
    basketDiscountTotal: '0.00',
    trendyolFundedTotal: '0.00',
    orderNetProfit,
    orderMarginPct: '10.00',
    currentOrderNetProfit: '90.00',
  };
}

function detailResponse() {
  return {
    id: CAMPAIGN_ID,
    name: 'Ağustos Kampanyası',
    discountType: 'NET',
    valueKind: 'PERCENT',
    value: '20',
    minBasketAmount: null,
    minQuantity: null,
    buyQuantity: null,
    payQuantity: null,
    nthIndex: null,
    trendyolFundingPct: '30.00',
    startsAt: null,
    endsAt: null,
    exported: false,
    commissionTariffName: 'Temmuz Tarifesi',
    commissionPeriodLabel: '7 - 14 Temmuz',
    commissionTariffOutdated: false,
    scenarioPresentation: 'UNIT',
    items: [noCustomPriceItem(), customPriceItem()],
  };
}

describe('useMarketplaceCampaignDetail', () => {
  it('fetches the campaign detail and adapts it into rows carrying all three scenarios, without fabricating a customScenario when none is saved', async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.json(detailResponse(), { status: 200 })));

    const { result } = renderHook(
      () => useMarketplaceCampaignDetail(ORG_ID, STORE_ID, CAMPAIGN_ID),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const detail = result.current.data;
    expect(detail).toBeDefined();
    if (detail === undefined) return;

    const { header, rows } = adaptMarketplaceCampaignDetail(detail);

    // Header carries the campaign-level config used to render the page header/config card.
    expect(header.id).toBe(CAMPAIGN_ID);
    expect(header.discountType).toBe('NET');
    expect(header.trendyolFundingPct).toBe('30.00');
    expect(header.scenarioPresentation).toBe('UNIT');

    expect(rows).toHaveLength(2);
    const [freeRow, customRow] = rows;

    // Row 1: current and maxScenario are DISTINCT scenarios, not collapsed into one figure —
    // the row must be able to tell "campaign-free" apart from "at the maximum price".
    expect(freeRow.current.price).toBe('100.00');
    expect(freeRow.current.netProfit).toBe('25.00');
    expect(freeRow.maxScenario.price).toBe('80.00');
    expect(freeRow.maxScenario.netProfit).toBe('10.00');
    // No custom price was saved server-side — the row must carry null, not a value copied
    // from another scenario (e.g. maxScenario) or an empty-but-truthy placeholder object.
    expect(freeRow.customScenario).toBeNull();
    expect(freeRow.selection).toBe('NONE');

    // Row 2: a saved custom price DOES produce a real customScenario, distinct from the other
    // two — proves the null case above is a genuine "not saved" state, not a mapping bug that
    // always drops the field.
    expect(customRow.customScenario).not.toBeNull();
    expect(customRow.customScenario?.price).toBe('120.00');
    expect(customRow.customScenario?.netProfit).toBe('15.00');
    expect(customRow.current.netProfit).toBe('60.00');
    expect(customRow.maxScenario.netProfit).toBe('30.00');
    expect(customRow.selection).toBe('CUSTOM');
  });

  it('keeps each price option on its own basket block — the custom block never replaces the maximum one', async () => {
    const orderItem = {
      ...customPriceItem(),
      maxBasket: basket(2, '300.00', '40.00'),
      customBasket: basket(2, '240.00', '20.00'),
    };
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json(
          {
            ...detailResponse(),
            discountType: 'BUY_X_PAY_Y',
            valueKind: null,
            value: null,
            buyQuantity: 2,
            payQuantity: 1,
            scenarioPresentation: 'ORDER',
            items: [orderItem],
          },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(
      () => useMarketplaceCampaignDetail(ORG_ID, STORE_ID, CAMPAIGN_ID),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const detail = result.current.data;
    if (detail === undefined) throw new Error('detail should be loaded');

    const { header, rows } = adaptMarketplaceCampaignDetail(detail);
    expect(header.scenarioPresentation).toBe('ORDER');
    const [row] = rows;
    // The row is CUSTOM-selected, yet the maximum card still reads the maximum's order.
    expect(row?.selection).toBe('CUSTOM');
    expect(row?.maxBasket?.basketTotal).toBe('300.00');
    expect(row?.maxBasket?.orderNetProfit).toBe('40.00');
    expect(row?.customBasket?.basketTotal).toBe('240.00');
    expect(row?.customBasket?.orderNetProfit).toBe('20.00');
  });

  it('does not fetch when campaignId is null (enabled=false path)', () => {
    const { result } = renderHook(() => useMarketplaceCampaignDetail(ORG_ID, STORE_ID, null), {
      wrapper,
    });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('does not fetch when storeId is null (enabled=false path)', () => {
    const { result } = renderHook(() => useMarketplaceCampaignDetail(ORG_ID, null, CAMPAIGN_ID), {
      wrapper,
    });
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
            detail: 'campaign missing',
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(
      () => useMarketplaceCampaignDetail(ORG_ID, STORE_ID, CAMPAIGN_ID),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
