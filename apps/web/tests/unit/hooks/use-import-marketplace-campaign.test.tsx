import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useImportMarketplaceCampaign } from '@/features/campaigns/hooks/use-import-marketplace-campaign';
import type { CampaignConfigFormValues } from '@/features/campaigns/lib/marketplace-campaign-config';
import { extractFileIssue } from '@/features/campaigns/lib/upload-error';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const CAMPAIGN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/marketplace-campaigns/import`;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// A funded basket campaign — the kurgu, Trendyol's funding rate and the window are not in the
// sheet, so they ride in on the multipart form. Typed as the form's output to prove it feeds the
// hook as-is.
const CAMPAIGN_CONFIG: CampaignConfigFormValues = {
  discountType: 'CONDITIONAL_BASKET',
  valueKind: 'AMOUNT',
  value: '100',
  minBasketAmount: '1000',
  trendyolFundingPct: '60',
  startsAt: '2026-08-01T10:00:00+03:00',
  endsAt: '2026-08-07T23:59:00+03:00',
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function importResponse() {
  return {
    campaignId: CAMPAIGN_ID,
    name: 'Ağustos Sepet Kampanyası',
    itemCount: 68,
    matched: 66,
    unmatched: 2,
    skippedRows: 0,
    prefilledRows: 0,
  };
}

describe('useImportMarketplaceCampaign', () => {
  it('uploads the file + campaign config as multipart/form-data and returns the summary', async () => {
    let contentType: string | null = null;
    let fields: Record<string, string> = {};
    let fileName: string | null = null;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        contentType = request.headers.get('content-type');
        const formData = await request.formData();
        const file = formData.get('file');
        fileName = file instanceof File ? file.name : null;
        fields = Object.fromEntries(
          [...formData.entries()].flatMap(([key, value]) =>
            typeof value === 'string' ? [[key, value]] : [],
          ),
        );
        return HttpResponse.json(importResponse(), { status: 201 });
      }),
    );

    const file = new File(['barkod'], 'kampanya.xlsx', { type: XLSX_TYPE });

    const { result } = renderHook(() => useImportMarketplaceCampaign(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate({ file, name: 'Ağustos Sepet Kampanyası', config: CAMPAIGN_CONFIG });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(contentType).toMatch(/^multipart\/form-data/);
    expect(fileName).toBe('kampanya.xlsx');
    // Every non-empty config field — the funding rate included — is appended alongside the file.
    expect(fields).toEqual({
      name: 'Ağustos Sepet Kampanyası',
      discountType: 'CONDITIONAL_BASKET',
      valueKind: 'AMOUNT',
      value: '100',
      minBasketAmount: '1000',
      trendyolFundingPct: '60',
      startsAt: '2026-08-01T10:00:00+03:00',
      endsAt: '2026-08-07T23:59:00+03:00',
    });
    expect(result.current.data?.campaignId).toBe(CAMPAIGN_ID);
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

    const file = new File(['x'], 'kampanya.xlsx', { type: XLSX_TYPE });

    const { result } = renderHook(() => useImportMarketplaceCampaign(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate({ file, config: CAMPAIGN_CONFIG });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedName).toBeNull();
  });

  it('invalidates the store campaign list on success', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.json(importResponse(), { status: 201 })));

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const file = new File(['x'], 'kampanya.xlsx', { type: XLSX_TYPE });
    const { result } = renderHook(() => useImportMarketplaceCampaign(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate({ file, config: CAMPAIGN_CONFIG });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['marketplace-campaigns', 'list', ORG_ID, STORE_ID],
    });
  });

  it('surfaces a rejected file as an ApiError the dialog can read the file code from', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation failed',
            status: 422,
            code: 'VALIDATION_ERROR',
            detail: 'invalid campaign file',
            errors: [{ field: 'file', code: 'WRONG_FILE_FOR_PAGE' }],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const file = new File(['x'], 'kampanya.xlsx', { type: XLSX_TYPE });
    const { result } = renderHook(() => useImportMarketplaceCampaign(ORG_ID, STORE_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate({ file, config: CAMPAIGN_CONFIG });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(extractFileIssue(result.current.error)).toEqual({
      code: 'WRONG_FILE_FOR_PAGE',
      meta: {},
    });
  });
});
