import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useConnectStore } from '@/features/stores/hooks/use-connect-store';
import { ApiError } from '@/lib/api-error';

import { createTestQueryClient } from '../../helpers/render';
import { server, http, HttpResponse } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const VALID_BODY = {
  name: 'Trendyol Mağazam',
  environment: 'PRODUCTION' as const,
  credentials: {
    platform: 'TRENDYOL' as const,
    supplierId: '99999',
    apiKey: 'api-key-1234',
    apiSecret: 'api-secret-abcd',
  },
};

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useConnectStore', () => {
  it('resolves with the created store on 201', async () => {
    server.use(
      http.post(`http://localhost:3001/v1/organizations/${ORG_ID}/stores`, () =>
        HttpResponse.json(
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
          { status: 201 },
        ),
      ),
    );

    const { result } = renderHook(() => useConnectStore(ORG_ID), { wrapper });
    result.current.mutate(VALID_BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.externalAccountId).toBe('99999');
  });

  it('surfaces a VALIDATION_ERROR with errors[] for form-level handling', async () => {
    server.use(
      http.post(`http://localhost:3001/v1/organizations/${ORG_ID}/stores`, () =>
        HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/validation',
            title: 'Validation error',
            status: 422,
            code: 'VALIDATION_ERROR',
            detail: 'Bad supplier id',
            errors: [
              {
                field: 'credentials.supplierId',
                code: 'INVALID_SUPPLIER_ID_FORMAT',
              },
            ],
          },
          { status: 422 },
        ),
      ),
    );

    const { result } = renderHook(() => useConnectStore(ORG_ID), { wrapper });
    result.current.mutate({
      ...VALID_BODY,
      credentials: { ...VALID_BODY.credentials, supplierId: 'bad id' },
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('VALIDATION_ERROR');
    expect((error as ApiError).problem.errors).toEqual([
      { field: 'credentials.supplierId', code: 'INVALID_SUPPLIER_ID_FORMAT' },
    ]);
  });

  it('surfaces MARKETPLACE_AUTH_FAILED as ApiError with that exact code', async () => {
    server.use(
      http.post(`http://localhost:3001/v1/organizations/${ORG_ID}/stores`, () =>
        HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/marketplace-auth-failed',
            title: 'Marketplace authentication failed',
            status: 422,
            code: 'MARKETPLACE_AUTH_FAILED',
            detail: 'Marketplace rejected the provided credentials',
            meta: { platform: 'TRENDYOL' },
          },
          { status: 422 },
        ),
      ),
    );

    const { result } = renderHook(() => useConnectStore(ORG_ID), { wrapper });
    result.current.mutate(VALID_BODY);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe('MARKETPLACE_AUTH_FAILED');
  });
});
