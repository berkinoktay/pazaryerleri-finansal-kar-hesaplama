import { describe, expect, it } from 'vitest';

import { newOrderInsertEvent } from '@/lib/supabase/realtime';

// Minimal payload shapes -- only eventType + new.id are read.
function insert(id: string) {
  return { eventType: 'INSERT' as const, new: { id }, old: {} };
}
function update(id: string) {
  return { eventType: 'UPDATE' as const, new: { id }, old: { id } };
}
function del(id: string) {
  return { eventType: 'DELETE' as const, new: {}, old: { id } };
}

describe('newOrderInsertEvent', () => {
  it('returns {table,id} on INSERT', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal payload stub
    expect(newOrderInsertEvent('buffer', insert('b1') as any)).toEqual({
      table: 'buffer',
      id: 'b1',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal payload stub
    expect(newOrderInsertEvent('orders', insert('o1') as any)).toEqual({
      table: 'orders',
      id: 'o1',
    });
  });

  it('returns null on UPDATE and DELETE', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal payload stub
    expect(newOrderInsertEvent('buffer', update('b1') as any)).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal payload stub
    expect(newOrderInsertEvent('buffer', del('b1') as any)).toBeNull();
  });
});
