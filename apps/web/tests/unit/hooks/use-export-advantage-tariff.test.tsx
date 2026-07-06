import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useExportAdvantageTariff } from '@/features/campaigns/hooks/use-export-advantage-tariff';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const TARIFF_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/advantage-tariffs/${TARIFF_ID}/export`;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// xlsx files are zip archives — "PK\x03\x04" is the ZIP local-file-header magic.
const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useExportAdvantageTariff', () => {
  it('resolves with the patched file bytes + the server-chosen filename (RFC 5987) on success', async () => {
    server.use(
      http.post(
        ENDPOINT,
        () =>
          new HttpResponse(XLSX_BYTES, {
            status: 200,
            headers: {
              'content-type': XLSX_TYPE,
              // Turkish name percent-encoded in the RFC 5987 `filename*` form — the parser
              // must decode it back to the accented original.
              'content-disposition': "attachment; filename*=UTF-8''avantajl%C4%B1-etiketler.xlsx",
            },
          }),
      ),
    );

    const { result } = renderHook(() => useExportAdvantageTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(TARIFF_ID);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.blob).toBeInstanceOf(Blob);
    expect(result.current.data?.blob.size).toBe(XLSX_BYTES.byteLength);
    expect(result.current.data?.filename).toBe('avantajlı-etiketler.xlsx');
  });

  it('resolves with a null filename when Content-Disposition is absent (caller falls back)', async () => {
    server.use(
      http.post(
        ENDPOINT,
        () => new HttpResponse(XLSX_BYTES, { status: 200, headers: { 'content-type': XLSX_TYPE } }),
      ),
    );

    const { result } = renderHook(() => useExportAdvantageTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(TARIFF_ID);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.filename).toBeNull();
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

    const { result } = renderHook(() => useExportAdvantageTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate(TARIFF_ID);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['advantage-tariffs', 'list', ORG_ID, STORE_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['advantage-tariffs', 'detail', ORG_ID, STORE_ID, TARIFF_ID],
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

    const { result } = renderHook(() => useExportAdvantageTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate(TARIFF_ID);

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
