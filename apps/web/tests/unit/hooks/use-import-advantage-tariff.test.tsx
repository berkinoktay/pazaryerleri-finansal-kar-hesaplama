import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useImportAdvantageTariff } from '@/features/campaigns/hooks/use-import-advantage-tariff';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/advantage-tariffs/import`;

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
    itemCount: 12,
    matched: 10,
    unmatched: 2,
    skippedRows: 0,
  };
}

describe('useImportAdvantageTariff', () => {
  it('uploads the file as multipart/form-data with the pinned commission source and returns the summary', async () => {
    let contentType: string | null = null;
    let capturedFile: unknown;
    let capturedName: unknown;
    let capturedSource: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        contentType = request.headers.get('content-type');
        const formData = await request.formData();
        capturedFile = formData.get('file');
        capturedName = formData.get('name');
        capturedSource = formData.get('commissionSourceTariffId');
        return HttpResponse.json(importResponse(), { status: 201 });
      }),
    );

    const file = new File(['barkod\tetiket'], 'avantajli-etiketler.xlsx', { type: XLSX_TYPE });

    const { result } = renderHook(() => useImportAdvantageTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate({
      file,
      name: 'Temmuz Avantaj etiketleri',
      commissionSourceTariffId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(contentType).toMatch(/^multipart\/form-data/);
    expect((capturedFile as File).name).toBe('avantajli-etiketler.xlsx');
    expect(capturedName).toBe('Temmuz Avantaj etiketleri');
    expect(capturedSource).toBe('dddddddd-dddd-dddd-dddd-dddddddddddd');
    expect(result.current.data?.matched).toBe(10);
    expect(result.current.data?.tariffId).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
  });

  it('omits the name and commission-source parts when neither is given', async () => {
    let capturedName: unknown = 'unset';
    let capturedSource: unknown = 'unset';
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const formData = await request.formData();
        capturedName = formData.get('name');
        capturedSource = formData.get('commissionSourceTariffId');
        return HttpResponse.json(importResponse(), { status: 201 });
      }),
    );

    const file = new File(['x'], 'avantajli-etiketler.xlsx', { type: XLSX_TYPE });

    const { result } = renderHook(() => useImportAdvantageTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate({ file });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedName).toBeNull();
    expect(capturedSource).toBeNull();
  });

  it('invalidates the store Advantage tariff list on success', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(importResponse(), { status: 201 })));

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const file = new File(['x'], 'avantajli-etiketler.xlsx', { type: XLSX_TYPE });
    const { result } = renderHook(() => useImportAdvantageTariff(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate({ file });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['advantage-tariffs', 'list', ORG_ID, STORE_ID],
    });
  });
});
