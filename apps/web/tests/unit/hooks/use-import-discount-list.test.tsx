import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useImportDiscountList } from '@/features/campaigns/hooks/use-import-discount-list';
import type { DiscountConfigFormValues } from '@/features/campaigns/lib/discount-config';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/discount-lists/import`;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// A NET percentage config — the discount kurgu rides in on the multipart form (Trendyol reuses
// the SAME product-selection sheet for every discount type).
const NET_CONFIG: DiscountConfigFormValues = {
  discountType: 'NET',
  valueKind: 'PERCENT',
  value: '20',
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function importResponse() {
  return {
    listId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    name: 'Temmuz İndirimleri',
    itemCount: 30,
    matched: 28,
    unmatched: 2,
    skippedRows: 0,
  };
}

describe('useImportDiscountList', () => {
  it('uploads the file + discount config as multipart/form-data and returns the summary', async () => {
    let contentType: string | null = null;
    let capturedFile: unknown;
    let capturedName: unknown;
    let capturedType: unknown;
    let capturedValueKind: unknown;
    let capturedValue: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        contentType = request.headers.get('content-type');
        const formData = await request.formData();
        capturedFile = formData.get('file');
        capturedName = formData.get('name');
        capturedType = formData.get('discountType');
        capturedValueKind = formData.get('valueKind');
        capturedValue = formData.get('value');
        return HttpResponse.json(importResponse(), { status: 201 });
      }),
    );

    const file = new File(['barkod\tindirim'], 'indirimler.xlsx', { type: XLSX_TYPE });

    const { result } = renderHook(() => useImportDiscountList(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate({ file, name: 'Temmuz İndirimleri', config: NET_CONFIG });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(contentType).toMatch(/^multipart\/form-data/);
    expect((capturedFile as File).name).toBe('indirimler.xlsx');
    expect(capturedName).toBe('Temmuz İndirimleri');
    // Every non-empty config field is appended alongside the file.
    expect(capturedType).toBe('NET');
    expect(capturedValueKind).toBe('PERCENT');
    expect(capturedValue).toBe('20');
    expect(result.current.data?.matched).toBe(28);
    expect(result.current.data?.listId).toBe('dddddddd-dddd-dddd-dddd-dddddddddddd');
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

    const file = new File(['x'], 'indirimler.xlsx', { type: XLSX_TYPE });

    const { result } = renderHook(() => useImportDiscountList(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate({ file, config: NET_CONFIG });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedName).toBeNull();
  });

  it('invalidates the store discount list on success', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(importResponse(), { status: 201 })));

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const file = new File(['x'], 'indirimler.xlsx', { type: XLSX_TYPE });
    const { result } = renderHook(() => useImportDiscountList(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate({ file, config: NET_CONFIG });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['discount-lists', 'list', ORG_ID, STORE_ID],
    });
  });
});
