import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { costsKeys } from '@/features/costs/hooks/costs-keys';
import { useAttachCostProfiles } from '@/features/costs/hooks/use-attach-cost-profiles';
import { useDetachCostProfiles } from '@/features/costs/hooks/use-detach-cost-profiles';
import { useReplaceCostProfiles } from '@/features/costs/hooks/use-replace-cost-profiles';

import { HttpResponse, http, server } from '../../../helpers/msw';

// Attaching, detaching or replacing cost profiles changes which variants miss
// cost. The products list's cost tab and the missing-cost banner count the same
// variants, so both caches must go stale together after each mutation.

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const PROFILE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VARIANT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ATTACHMENTS_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/cost-profile-attachments`;
const PRODUCTS_LIST_KEY = ['products', 'list', { storeId: 'store-1' }];

function makeQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 60_000, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  client.setQueryData(PRODUCTS_LIST_KEY, { data: [] });
  client.setQueryData(costsKeys.missingCostStats(ORG_ID), { count: 1 });
  return client;
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function expectCostCountsInvalidated(client: QueryClient): void {
  expect(client.getQueryState(PRODUCTS_LIST_KEY)?.isInvalidated).toBe(true);
  expect(client.getQueryState(costsKeys.missingCostStats(ORG_ID))?.isInvalidated).toBe(true);
}

const ARGS = { orgId: ORG_ID, profileIds: [PROFILE_ID], variantIds: [VARIANT_ID] };

describe('cost attachment mutations refresh the missing-cost counts', () => {
  it('attach invalidates the products list and the missing-cost stats', async () => {
    server.use(
      http.post(`${ATTACHMENTS_URL}/attach`, () =>
        HttpResponse.json({ attached: 1, bufferEntriesPromoted: 0 }),
      ),
    );
    const client = makeQueryClient();
    const { result } = renderHook(() => useAttachCostProfiles(), {
      wrapper: makeWrapper(client),
    });

    result.current.mutate(ARGS);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expectCostCountsInvalidated(client);
  });

  it('detach invalidates the products list and the missing-cost stats', async () => {
    server.use(http.post(`${ATTACHMENTS_URL}/detach`, () => HttpResponse.json({ detached: 1 })));
    const client = makeQueryClient();
    const { result } = renderHook(() => useDetachCostProfiles(), {
      wrapper: makeWrapper(client),
    });

    result.current.mutate(ARGS);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expectCostCountsInvalidated(client);
  });

  it('replace invalidates the products list and the missing-cost stats', async () => {
    server.use(
      http.post(`${ATTACHMENTS_URL}/replace`, () =>
        HttpResponse.json({
          variantsAffected: 1,
          finalProfilesPerVariant: 1,
          bufferEntriesPromoted: 0,
        }),
      ),
    );
    const client = makeQueryClient();
    const { result } = renderHook(() => useReplaceCostProfiles(), {
      wrapper: makeWrapper(client),
    });

    result.current.mutate(ARGS);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expectCostCountsInvalidated(client);
  });
});
