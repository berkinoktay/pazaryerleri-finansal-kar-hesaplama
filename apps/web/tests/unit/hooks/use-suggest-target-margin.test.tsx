import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useSuggestTargetMargin } from '@/features/campaigns/hooks/use-suggest-target-margin';
import { ApiError } from '@/lib/api-error';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const CAMPAIGN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/marketplace-campaigns/${CAMPAIGN_ID}/target-margin`;

/** One reachable item, one the target cannot reach, one missing its cost — in campaign order. */
const SUGGESTIONS = {
  suggestions: [
    { itemId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', price: '172.40', reason: null },
    { itemId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', price: null, reason: 'UNREACHABLE' },
    { itemId: 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee', price: null, reason: 'NOT_CALCULABLE' },
  ],
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useSuggestTargetMargin', () => {
  it('POSTs the target margin and returns the per-item suggestions, writing nothing', async () => {
    let received: unknown = null;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(SUGGESTIONS);
      }),
    );

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSuggestTargetMargin(ORG_ID, STORE_ID, CAMPAIGN_ID), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate({ targetMarginPct: '15' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(received).toEqual({ targetMarginPct: '15' });
    expect(result.current.data).toEqual(SUGGESTIONS);
    // The suggestions go to the local buffer; only the selections save persists them.
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('surfaces a 404 for a campaign outside the store as an ApiError', async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Not found',
            status: 404,
            code: 'NOT_FOUND',
            detail: 'campaign missing',
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(() => useSuggestTargetMargin(ORG_ID, STORE_ID, CAMPAIGN_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });
    result.current.mutate({ targetMarginPct: '15' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});
