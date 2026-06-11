import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useReturnsSummary } from '@/features/returns/hooks/use-returns-summary';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const STORE_ID = '22222222-2222-2222-2222-222222222222';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/claims/summary`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useReturnsSummary', () => {
  it('fetches the KPI summary for the period', async () => {
    server.use(
      http.get(URL, () =>
        HttpResponse.json({
          openCount: 4,
          resolvedInPeriod: 12,
          refundDeductionGross: '785.50',
          commissionRefundGross: '71.41',
          costReturnGross: '120.00',
          netImpactGross: '-594.09',
        }),
      ),
    );

    const { result } = renderHook(
      () =>
        useReturnsSummary({
          orgId: ORG_ID,
          storeId: STORE_ID,
          from: '2026-05-12',
          to: '2026-06-11',
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.openCount).toBe(4);
    expect(result.current.data?.netImpactGross).toBe('-594.09');
  });
});
