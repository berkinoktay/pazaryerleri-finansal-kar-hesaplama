import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useArchiveCostProfile } from '@/features/costs/hooks/use-archive-cost-profile';
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

const ARCHIVED_PROFILE = {
  id: PROFILE_ID,
  organizationId: ORG_ID,
  name: 'Test COGS',
  type: 'COGS' as const,
  amount: '10.00',
  currency: 'TRY' as const,
  vatRate: 18,
  fxRateMode: 'AUTO' as const,
  manualFxRate: null,
  note: null,
  archivedAt: '2026-05-09T13:00:00Z',
  createdBy: null,
  updatedBy: null,
  createdAt: '2026-05-09T12:00:00Z',
  updatedAt: '2026-05-09T13:00:00Z',
};

describe('useArchiveCostProfile', () => {
  it('runs the mutation and invalidates profile + profiles list + variant attachments', async () => {
    server.use(
      http.post(
        `http://localhost:3001/v1/organizations/${ORG_ID}/cost-profiles/${PROFILE_ID}/archive`,
        () => HttpResponse.json(ARCHIVED_PROFILE),
      ),
    );

    const queryClient = makeQueryClient();
    // Pre-seed all keys that should be invalidated
    queryClient.setQueryData(costsKeys.profile(PROFILE_ID), {
      ...ARCHIVED_PROFILE,
      archivedAt: null,
    });
    queryClient.setQueryData(costsKeys.profiles(), {
      data: [{ ...ARCHIVED_PROFILE, archivedAt: null }],
      meta: {},
    });

    const { result } = renderHook(() => useArchiveCostProfile(), {
      wrapper: makeWrapper(queryClient),
    });

    result.current.mutate({ orgId: ORG_ID, profileId: PROFILE_ID });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.archivedAt).toBe('2026-05-09T13:00:00Z');

    // profile(PROFILE_ID) should be invalidated
    expect(queryClient.getQueryState(costsKeys.profile(PROFILE_ID))?.isInvalidated).toBe(true);
    // profiles() should be invalidated
    expect(queryClient.getQueryState(costsKeys.profiles())?.isInvalidated).toBe(true);
  });
});
