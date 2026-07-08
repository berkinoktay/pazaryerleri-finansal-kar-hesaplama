import { describe, expect, it } from 'vitest';

import { newOrderInsertEvent } from '@/lib/supabase/realtime';

// Real orders wire shape: a timestamp-without-tz UTC wall clock, NO 'Z' / offset
// (exactly what supabase realtime-js emits for `orders.order_date`).
const ORDER_DATE = '2026-07-08T09:00:00';

// Minimal payload shapes -- only eventType + new.id + new.order_date are read.
function insert(id: string) {
  return { eventType: 'INSERT' as const, new: { id, order_date: ORDER_DATE }, old: {} };
}
function update(id: string) {
  return {
    eventType: 'UPDATE' as const,
    new: { id, order_date: ORDER_DATE },
    old: { id, order_date: ORDER_DATE },
  };
}
function del(id: string) {
  return { eventType: 'DELETE' as const, new: {}, old: { id, order_date: ORDER_DATE } };
}

describe('newOrderInsertEvent', () => {
  it('returns {table,id,orderDate} on INSERT', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal payload stub
    expect(newOrderInsertEvent('buffer', insert('b1') as any)).toEqual({
      table: 'buffer',
      id: 'b1',
      orderDate: ORDER_DATE,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal payload stub
    expect(newOrderInsertEvent('orders', insert('o1') as any)).toEqual({
      table: 'orders',
      id: 'o1',
      orderDate: ORDER_DATE,
    });
  });

  it('returns null on UPDATE and DELETE', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal payload stub
    expect(newOrderInsertEvent('buffer', update('b1') as any)).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal payload stub
    expect(newOrderInsertEvent('buffer', del('b1') as any)).toBeNull();
  });
});
