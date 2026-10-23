import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useCustomPriceWhatIf } from '@/features/campaigns/hooks/use-custom-price-what-if';
import type {
  CampaignScenario,
  MarketplaceCampaignRow,
} from '@/features/campaigns/lib/adapt-marketplace-campaign';
import { TariffScopeProvider } from '@/features/campaigns/lib/tariff-scope';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const SCOPE = {
  orgId: '00000000-0000-0000-0000-000000000099',
  storeId: '00000000-0000-0000-0000-000000000088',
  tariffId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
};
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENDPOINT = `http://localhost:3001/v1/organizations/${SCOPE.orgId}/stores/${SCOPE.storeId}/marketplace-campaigns/${SCOPE.tariffId}/items/${ITEM_ID}/estimate`;
// Comfortably past the hook's 400ms debounce.
const PAST_DEBOUNCE_MS = 600;

function scenario(price: string): CampaignScenario {
  return {
    price,
    commissionPct: '18.0000',
    commissionSource: 'product',
    netProfit: '10.00',
    marginPct: '5.00',
  };
}

/** Maximum 200; a custom price of 150 is already SAVED on the row. */
const ROW: MarketplaceCampaignRow = {
  id: ITEM_ID,
  barcode: '8681234567890',
  productCode: null,
  externalId: null,
  productTitle: 'Kampanya Ürünü',
  brand: null,
  color: null,
  size: null,
  category: null,
  stock: null,
  imageUrl: null,
  currentPrice: '250.00',
  maxPrice: '200.00',
  hasCommissionTariff: false,
  selection: 'MAX',
  customPrice: '150.00',
  calculable: true,
  reason: null,
  current: scenario('250.00'),
  maxScenario: scenario('200.00'),
  customScenario: scenario('150.00'),
  commissionBands: null,
  maxBasket: null,
  customBasket: null,
};

/** Records the estimated prices and answers with that price echoed back. */
function trackEstimates(): string[] {
  const prices: string[] = [];
  server.use(
    http.post(ENDPOINT, async ({ request }) => {
      const body: unknown = await request.json();
      const price =
        typeof body === 'object' && body !== null && 'customPrice' in body
          ? String(body.customPrice)
          : '';
      prices.push(price);
      return HttpResponse.json({
        itemId: ITEM_ID,
        scenario: 'custom',
        price,
        customerPaidUnitPrice: price,
        trendyolFundedUnitAmount: '0.00',
        commissionPct: '18.0000',
        commissionSource: 'product',
        calculable: true,
        reason: null,
        breakdown: null,
        breakdownScope: 'unit',
        basket: null,
        commissionTariffName: null,
        commissionPeriodLabel: null,
      });
    }),
  );
  return prices;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <TariffScopeProvider scope={SCOPE}>{children}</TariffScopeProvider>
    </QueryClientProvider>
  );
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('useCustomPriceWhatIf', () => {
  it('asks nothing for the saved price — its figures already ride on the row', async () => {
    const prices = trackEstimates();
    const { result } = renderHook(() => useCustomPriceWhatIf(ROW, '150.00'), { wrapper });

    await wait(PAST_DEBOUNCE_MS);
    expect(prices).toEqual([]);
    expect(result.current.result).toBeNull();
  });

  it('prices a new valid price after the debounce and returns it for exactly that price', async () => {
    const prices = trackEstimates();
    const { result } = renderHook(() => useCustomPriceWhatIf(ROW, '120.00'), { wrapper });

    await waitFor(() => expect(result.current.result?.price).toBe('120.00'));
    expect(prices).toEqual(['120.00']);
  });

  it('never prices a price above the maximum', async () => {
    const prices = trackEstimates();
    renderHook(() => useCustomPriceWhatIf(ROW, '250.00'), { wrapper });

    await wait(PAST_DEBOUNCE_MS);
    expect(prices).toEqual([]);
  });

  it('prices even the saved price at once when asked to (an open breakdown)', async () => {
    const prices = trackEstimates();
    const { result } = renderHook(() => useCustomPriceWhatIf(ROW, '150.00', true), { wrapper });

    await waitFor(() => expect(result.current.result?.price).toBe('150.00'));
    expect(prices).toEqual(['150.00']);
  });
});
