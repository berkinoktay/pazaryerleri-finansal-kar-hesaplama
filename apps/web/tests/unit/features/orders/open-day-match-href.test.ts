import { describe, expect, it } from 'vitest';

import type { OpenDayMatch } from '@/features/orders/api/list-orders.api';
import { openDayMatchHref } from '@/features/orders/lib/open-day-match-href';

const ORDER_ID = '00000000-0000-0000-0000-0000000000a1';
const BUFFER_ID = '00000000-0000-0000-0000-0000000000b1';

function match(over: Partial<OpenDayMatch>): OpenDayMatch {
  return { source: 'orders', id: ORDER_ID, orderNumber: 'TY-TODAY-1', cancelled: false, ...over };
}

describe('openDayMatchHref', () => {
  it('links a stored order to its live-performance deep link', () => {
    expect(openDayMatchHref(match({}))).toBe(`/live-performance?order=${ORDER_ID}`);
  });

  it("links a cancelled stored order to live performance's cancelled tab", () => {
    expect(openDayMatchHref(match({ cancelled: true }))).toBe(
      '/live-performance?ordersFilter=cancelled',
    );
  });

  it('links a buffer entry to live performance', () => {
    expect(openDayMatchHref(match({ source: 'buffer', id: BUFFER_ID }))).toBe('/live-performance');
  });
});
