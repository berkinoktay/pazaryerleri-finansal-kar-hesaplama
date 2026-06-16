import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useUpdateCostProfile } from '@/features/costs/hooks/use-update-cost-profile';
import { costsKeys } from '@/features/costs/hooks/costs-keys';
import { productKeys } from '@/features/products/query-keys';

import { HttpResponse, http, server } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const PROFILE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

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

const BASE_PROFILE = {
  id: PROFILE_ID,
  organizationId: ORG_ID,
  name: 'COGS v1',
  type: 'COGS' as const,
  amountGross: '10.00',
  currency: 'TRY' as const,
  vatRate: 18,
  fxRateMode: 'AUTO' as const,
  manualFxRate: null,
  note: null,
  archivedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: '2026-05-09T12:00:00Z',
  updatedAt: '2026-05-09T12:00:00Z',
};

describe('useUpdateCostProfile', () => {
  it('runs the mutation and invalidates profile, versions, profiles list, and products', async () => {
    const UPDATED_PROFILE = { ...BASE_PROFILE, name: 'COGS v2', amountGross: '15.00' };

    server.use(
      http.patch(
        `http://localhost:3001/v1/organizations/${ORG_ID}/cost-profiles/${PROFILE_ID}`,
        () => HttpResponse.json(UPDATED_PROFILE),
      ),
    );

    const queryClient = makeQueryClient();
    queryClient.setQueryData(costsKeys.profile(PROFILE_ID), BASE_PROFILE);
    queryClient.setQueryData(costsKeys.profileVersions(PROFILE_ID), { data: [], meta: {} });
    queryClient.setQueryData(costsKeys.profiles(), { data: [BASE_PROFILE], meta: {} });
    // Seed a products cache entry to assert it gets invalidated
    queryClient.setQueryData(productKeys.all, []);

    const { result } = renderHook(() => useUpdateCostProfile(), {
      wrapper: makeWrapper(queryClient),
    });

    result.current.mutate({
      orgId: ORG_ID,
      profileId: PROFILE_ID,
      body: {
        name: 'COGS v2',
        amountGross: '15.00',
        currency: 'TRY',
        vatRate: 18,
        fxRateMode: 'AUTO',
      },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe('COGS v2');

    // All four keys from the invalidation matrix should be invalidated
    expect(queryClient.getQueryState(costsKeys.profile(PROFILE_ID))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(costsKeys.profileVersions(PROFILE_ID))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(costsKeys.profiles())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(productKeys.all)?.isInvalidated).toBe(true);
  });
});
