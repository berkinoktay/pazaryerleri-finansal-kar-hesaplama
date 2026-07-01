import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useImportTariff } from '@/features/campaigns/hooks/use-import-tariff';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/commission-tariffs/import`;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function importResponse() {
  return {
    tariffId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    productCount: 12,
    periodCount: 1,
    itemCount: 12,
    matched: 10,
    unmatched: 2,
    skippedRows: 0,
  };
}

describe('useImportTariff', () => {
  it('uploads the file as multipart/form-data and returns the import summary', async () => {
    let contentType: string | null = null;
    let capturedFile: unknown;
    let capturedName: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        contentType = request.headers.get('content-type');
        const formData = await request.formData();
        capturedFile = formData.get('file');
        capturedName = formData.get('name');
        return HttpResponse.json(importResponse(), { status: 201 });
      }),
    );

    const file = new File(['barkod\tfiyat'], 'tarife.xlsx', { type: XLSX_TYPE });

    const { result } = renderHook(() => useImportTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate({ file, name: 'Temmuz tarifesi' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(contentType).toMatch(/^multipart\/form-data/);
    expect((capturedFile as File).name).toBe('tarife.xlsx');
    expect(capturedName).toBe('Temmuz tarifesi');
    expect(result.current.data?.matched).toBe(10);
    expect(result.current.data?.tariffId).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
  });

  it('omits the name part when no name is given', async () => {
    let capturedName: unknown = 'unset';
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const formData = await request.formData();
        capturedName = formData.get('name');
        return HttpResponse.json(importResponse(), { status: 201 });
      }),
    );

    const file = new File(['x'], 'tarife.xlsx', { type: XLSX_TYPE });

    const { result } = renderHook(() => useImportTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate({ file });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedName).toBeNull();
  });

  it('invalidates the store tariff list on success', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(importResponse(), { status: 201 })));

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const file = new File(['x'], 'tarife.xlsx', { type: XLSX_TYPE });
    const { result } = renderHook(() => useImportTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate({ file });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['commission-tariffs', 'list', ORG_ID, STORE_ID],
    });
  });
});
