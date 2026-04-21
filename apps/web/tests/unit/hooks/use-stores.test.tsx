import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useStores } from '@/features/stores/hooks/use-stores';
import { ApiError } from '@/lib/api-error';

import { createTestQueryClient } from '../../helpers/render';
import { server, http, HttpResponse } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useStores', () => {
  it('returns the list on success', async () => {
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/stores`, () =>
        HttpResponse.json(
          {
            data: [
              {
                id: '10000000-0000-0000-0000-000000000001',
                name: 'Trendyol Mağazam',
                platform: 'TRENDYOL',
                environment: 'PRODUCTION',
                externalAccountId: '99999',
                status: 'ACTIVE',
                lastConnectedAt: '2026-04-21T10:00:00Z',
                lastSyncAt: null,
                createdAt: '2026-04-21T10:00:00Z',
                updatedAt: '2026-04-21T10:00:00Z',
              },
            ],
          },
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useStores(ORG_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.platform).toBe('TRENDYOL');
  });

  it('does not fire when orgId is null (enabled=false)', () => {
    const { result } = renderHook(() => useStores(null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('surfaces an ApiError with the backend code on 403', async () => {
    server.use(
      http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/stores`, () =>
        HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/forbidden',
            title: 'Access denied',
            status: 403,
            code: 'FORBIDDEN',
            detail: 'Not a member',
          },
          { status: 403 },
        ),
      ),
    );

    const { result } = renderHook(() => useStores(ORG_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe('FORBIDDEN');
  });
});
