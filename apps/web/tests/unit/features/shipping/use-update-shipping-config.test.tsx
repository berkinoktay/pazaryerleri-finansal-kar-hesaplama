import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { shippingKeys } from '@/features/shipping/hooks/use-shipping-carriers';
import { useUpdateShippingConfig } from '@/features/shipping/hooks/use-update-shipping-config';

import { HttpResponse, http, server } from '../../../helpers/msw';

const ORG_ID = '6c2b7a91-3e4d-4f5e-9a8b-7c6d5e4f3a2b';
const STORE_ID = '9d3c1b80-2f5e-4a6b-8c7d-9e0f1a2b3c4d';
const CARRIER_ID = '7f4e8c4a-bc23-4d3e-9b1a-0a1f2c3d4e5f';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 60_000, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const UPDATED_CONFIG = {
  shippingTariffSource: 'TRENDYOL_CONTRACT' as const,
  defaultShippingCarrierId: CARRIER_ID,
  defaultShippingCarrier: {
    id: CARRIER_ID,
    platform: 'TRENDYOL' as const,
    externalId: 38,
    code: 'SENDEOMP',
    displayName: 'Kolay Gelsin',
    supportsBaremDestek: true,
    maxBaremDesi: 10,
    sortOrder: 7,
  },
};

describe('useUpdateShippingConfig', () => {
  it('PATCHes the shipping-config endpoint and returns the updated config', async () => {
    server.use(
      http.patch(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/shipping-config`,
        () => HttpResponse.json(UPDATED_CONFIG),
      ),
    );

    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useUpdateShippingConfig(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(queryClient),
    });

    result.current.mutate({
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: CARRIER_ID,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.shippingTariffSource).toBe('TRENDYOL_CONTRACT');
    expect(result.current.data?.defaultShippingCarrierId).toBe(CARRIER_ID);
  });

  it('invalidates the shipping config + products list keys on success', async () => {
    server.use(
      http.patch(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/shipping-config`,
        () => HttpResponse.json(UPDATED_CONFIG),
      ),
    );

    const queryClient = makeQueryClient();
    // Seed both caches so we can assert they get invalidated after the mutation
    queryClient.setQueryData(shippingKeys.config(STORE_ID), UPDATED_CONFIG);
    queryClient.setQueryData(['products'], []);

    const { result } = renderHook(() => useUpdateShippingConfig(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(queryClient),
    });

    result.current.mutate({
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: CARRIER_ID,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryState(shippingKeys.config(STORE_ID))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['products'])?.isInvalidated).toBe(true);
  });
});
