import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { http, HttpResponse, server } from '../../helpers/msw';
import { createTestQueryClient } from '../../helpers/render';
import { useBufferDetail } from '@/features/live-performance/hooks/use-buffer-detail';

const ORG = '11111111-1111-1111-1111-111111111111';
const STORE = '22222222-2222-2222-2222-222222222222';
const BUF = '33333333-3333-3333-3333-333333333333';
const URL = `http://localhost:3001/v1/organizations/${ORG}/stores/${STORE}/live-performance/buffer/${BUF}`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useBufferDetail', () => {
  it('fetches the enriched buffer detail', async () => {
    server.use(
      http.get(URL, () =>
        HttpResponse.json({
          platformOrderNumber: 'TY-123',
          orderDate: '2026-06-05T08:00:00.000Z',
          status: 'PENDING',
          saleSubtotalNet: '200.00',
          lines: [
            {
              barcode: 'BC-1',
              productName: 'Tisort',
              thumbUrl: null,
              variantId: 'v1',
              stockCode: 'SKU-1',
              quantity: 2,
              unitPriceNet: '100.00',
            },
          ],
        }),
      ),
    );

    const { result } = renderHook(() => useBufferDetail(ORG, STORE, BUF), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.lines[0].productName).toBe('Tisort');
  });

  it('is disabled when bufferId is null', () => {
    const { result } = renderHook(() => useBufferDetail(ORG, STORE, null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
