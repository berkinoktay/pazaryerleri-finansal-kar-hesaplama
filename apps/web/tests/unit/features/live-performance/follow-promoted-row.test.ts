import { describe, expect, it } from 'vitest';

import type { LiveOrderRow } from '@/features/live-performance/api/get-live-orders.api';
import { followPromotedRow } from '@/features/live-performance/lib/follow-promoted-row';

function row(over: Partial<LiveOrderRow>): LiveOrderRow {
  return {
    source: 'orders',
    platformOrderId: 'p-1',
    platformOrderNumber: null,
    orderId: null,
    bufferId: null,
    orderDate: '2026-06-05T00:00:00.000Z',
    status: 'PENDING',
    revenue: '100.00',
    profit: null,
    margin: null,
    promotionDisplays: null,
    ...over,
  };
}

const bufferRow = row({ source: 'buffer', bufferId: 'b-1', platformOrderId: 'p-1' });
const promotedRow = row({ source: 'orders', orderId: 'o-1', platformOrderId: 'p-1' });
const otherOrderRow = row({ source: 'orders', orderId: 'o-2', platformOrderId: 'p-2' });

describe('followPromotedRow', () => {
  it('returns null when nothing is selected', () => {
    expect(followPromotedRow([promotedRow], null)).toBeNull();
  });

  it('returns an orders-source selection unchanged', () => {
    expect(followPromotedRow([otherOrderRow], promotedRow)).toBe(promotedRow);
  });

  it('keeps the buffer row while it is still in the list', () => {
    const fresh = row({ source: 'buffer', bufferId: 'b-1', platformOrderId: 'p-1' });
    expect(followPromotedRow([fresh, promotedRow], bufferRow)).toBe(bufferRow);
  });

  it('follows a promoted buffer row to the orders row with the same platformOrderId', () => {
    expect(followPromotedRow([otherOrderRow, promotedRow], bufferRow)).toBe(promotedRow);
  });

  it('keeps the selection when neither the buffer row nor its order is listed yet', () => {
    expect(followPromotedRow([otherOrderRow], bufferRow)).toBe(bufferRow);
  });

  it('keeps the selection while the rows are still loading', () => {
    expect(followPromotedRow(undefined, bufferRow)).toBe(bufferRow);
  });
});
