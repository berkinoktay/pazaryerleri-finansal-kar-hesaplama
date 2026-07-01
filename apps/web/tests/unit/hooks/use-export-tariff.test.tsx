import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useExportTariff } from '@/features/campaigns/hooks/use-export-tariff';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const TARIFF_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/commission-tariffs/${TARIFF_ID}/export`;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// xlsx files are zip archives — "PK\x03\x04" is the ZIP local-file-header magic.
const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useExportTariff', () => {
  it('resolves with the patched xlsx Blob on success', async () => {
    server.use(
      http.post(
        ENDPOINT,
        () => new HttpResponse(XLSX_BYTES, { status: 200, headers: { 'content-type': XLSX_TYPE } }),
      ),
    );

    const { result } = renderHook(() => useExportTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(TARIFF_ID);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeInstanceOf(Blob);
    expect(result.current.data?.size).toBe(XLSX_BYTES.byteLength);
  });

  it('invalidates both the list and that tariff detail on success', async () => {
    server.use(
      http.post(
        ENDPOINT,
        () => new HttpResponse(XLSX_BYTES, { status: 200, headers: { 'content-type': XLSX_TYPE } }),
      ),
    );

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useExportTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate(TARIFF_ID);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['commission-tariffs', 'list', ORG_ID, STORE_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['commission-tariffs', 'detail', ORG_ID, STORE_ID, TARIFF_ID],
    });
  });

  it('throws an ApiError when the endpoint returns a JSON problem (404)', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Not found',
            status: 404,
            code: 'NOT_FOUND',
            detail: 'tariff missing',
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(() => useExportTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(TARIFF_ID);

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
