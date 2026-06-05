import { describe, expect, it } from 'vitest';

import { getNotificationSummary } from '@/features/live-performance/api/get-notification-summary.api';

import { HttpResponse, http, server } from '../../../helpers/msw';

const ORG = '00000000-0000-0000-0000-000000000001';
const STORE = '00000000-0000-0000-0000-000000000002';
const ID = '00000000-0000-0000-0000-000000000003';
const PATH = `http://localhost:3001/v1/organizations/${ORG}/stores/${STORE}/live-performance/notification-summary`;

describe('getNotificationSummary', () => {
  it('returns the typed summary on 200', async () => {
    server.use(
      http.get(PATH, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('source')).toBe('orders');
        expect(url.searchParams.get('id')).toBe(ID);
        return HttpResponse.json({
          source: 'orders',
          orderId: ID,
          bufferId: null,
          platformOrderNumber: 'TY-1',
          revenue: '120.00',
          profit: '30.00',
          costStatus: 'costed',
          isToday: true,
        });
      }),
    );

    const result = await getNotificationSummary({
      orgId: ORG,
      storeId: STORE,
      source: 'orders',
      id: ID,
    });
    expect(result.revenue).toBe('120.00');
    expect(result.costStatus).toBe('costed');
  });

  it('throws an ApiError on 404', async () => {
    server.use(
      http.get(PATH, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND' },
          { status: 404 },
        ),
      ),
    );

    await expect(
      getNotificationSummary({ orgId: ORG, storeId: STORE, source: 'buffer', id: ID }),
    ).rejects.toThrow();
  });
});
