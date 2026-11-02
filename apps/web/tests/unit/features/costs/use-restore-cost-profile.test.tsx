import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useRestoreCostProfile } from '@/features/costs/hooks/use-restore-cost-profile';
import { costsKeys } from '@/features/costs/hooks/costs-keys';

import { HttpResponse, http, server } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const PROFILE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

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

const RESTORED_PROFILE = {
  id: PROFILE_ID,
  organizationId: ORG_ID,
  name: 'Ambalaj Maliyeti',
  type: 'PACKAGING' as const,
  amountGross: '5.00',
  vatRate: 20,
  note: null,
  archivedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: '2026-05-08T10:00:00Z',
  updatedAt: '2026-05-09T14:00:00Z',
};

describe('useRestoreCostProfile', () => {
  it('runs the mutation and invalidates profile + profiles list keys', async () => {
    server.use(
      http.post(
        `http://localhost:3001/v1/organizations/${ORG_ID}/cost-profiles/${PROFILE_ID}/restore`,
        () => HttpResponse.json(RESTORED_PROFILE),
      ),
    );

    const queryClient = makeQueryClient();
    queryClient.setQueryData(costsKeys.profile(PROFILE_ID), {
      ...RESTORED_PROFILE,
      archivedAt: '2026-05-08T15:00:00Z',
    });
    queryClient.setQueryData(costsKeys.profiles(ORG_ID), {
      data: [{ ...RESTORED_PROFILE, archivedAt: '2026-05-08T15:00:00Z' }],
      meta: {},
    });

    // The products list and the missing-cost banner change with the profile's
    // archived state.
    const productsListKey = ['products', 'list', { storeId: 'store-1' }];
    queryClient.setQueryData(productsListKey, { data: [] });
    queryClient.setQueryData(costsKeys.missingCostStats(ORG_ID), { count: 1 });

    const { result } = renderHook(() => useRestoreCostProfile(), {
      wrapper: makeWrapper(queryClient),
    });

    result.current.mutate({ orgId: ORG_ID, profileId: PROFILE_ID });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.archivedAt).toBeNull();

    expect(queryClient.getQueryState(costsKeys.profile(PROFILE_ID))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(costsKeys.profiles(ORG_ID))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(productsListKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(costsKeys.missingCostStats(ORG_ID))?.isInvalidated).toBe(true);
  });
});
