import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useCreateCostProfile } from '@/features/costs/hooks/use-create-cost-profile';
import { costsKeys } from '@/features/costs/hooks/costs-keys';

import { HttpResponse, http, server } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const PROFILE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

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

const PROFILE_RESPONSE = {
  id: PROFILE_ID,
  organizationId: ORG_ID,
  name: 'Test COGS',
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

describe('useCreateCostProfile', () => {
  it('runs the mutation and invalidates the profiles list key', async () => {
    server.use(
      http.post(`http://localhost:3001/v1/organizations/${ORG_ID}/cost-profiles`, () =>
        HttpResponse.json(PROFILE_RESPONSE, { status: 201 }),
      ),
    );

    const queryClient = makeQueryClient();
    // Pre-seed the profiles list so we can assert invalidation
    queryClient.setQueryData(costsKeys.profiles(), { data: [], meta: {} });

    const { result } = renderHook(() => useCreateCostProfile(), {
      wrapper: makeWrapper(queryClient),
    });

    result.current.mutate({
      orgId: ORG_ID,
      body: {
        name: 'Test COGS',
        type: 'COGS',
        amountGross: '10.00',
        currency: 'TRY',
        vatRate: 18,
        fxRateMode: 'AUTO',
      },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe(PROFILE_ID);

    // After success, the profiles() cache key should be invalidated (stale)
    const state = queryClient.getQueryState(costsKeys.profiles());
    expect(state?.isInvalidated).toBe(true);
  });
});
