import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useDisconnectStore } from '@/features/stores/hooks/use-disconnect-store';

import { createTestQueryClient } from '../../helpers/render';
import { server, http, HttpResponse } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '10000000-0000-0000-0000-000000000001';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useDisconnectStore', () => {
  it('resolves on 204 No Content', async () => {
    server.use(
      http.delete(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );

    const { result } = renderHook(() => useDisconnectStore(ORG_ID), { wrapper });
    result.current.mutate(STORE_ID);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('surfaces 404 NOT_FOUND when the store is not found', async () => {
    server.use(
      http.delete(`http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}`, () =>
        HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/not-found',
            title: 'Not found',
            status: 404,
            code: 'NOT_FOUND',
            detail: 'Store not found',
          },
          { status: 404 },
        ),
      ),
    );

    const { result } = renderHook(() => useDisconnectStore(ORG_ID), { wrapper });
    result.current.mutate(STORE_ID);

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
