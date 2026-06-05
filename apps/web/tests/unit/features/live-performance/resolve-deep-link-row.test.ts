import { describe, expect, it } from 'vitest';

import type { LiveOrderRow } from '@/features/live-performance/api/get-live-orders.api';
import { resolveDeepLinkRow } from '@/features/live-performance/lib/resolve-deep-link-row';

function row(over: Partial<LiveOrderRow>): LiveOrderRow {
  // Cast: tests only exercise the id-matching fields the resolver reads.
  return {
    source: 'orders',
    orderId: null,
    bufferId: null,
    platformOrderId: 'p',
    platformOrderNumber: null,
    orderDate: '2026-06-05T00:00:00.000Z',
    ...over,
  } as LiveOrderRow;
}

describe('resolveDeepLinkRow', () => {
  const rows = [
    row({ orderId: 'o1', source: 'orders' }),
    row({ bufferId: 'b1', source: 'buffer' }),
  ];

  it('returns null while rows are undefined (still loading)', () => {
    expect(resolveDeepLinkRow(undefined, 'o1', null)).toBeNull();
  });

  it('returns null with no params', () => {
    expect(resolveDeepLinkRow(rows, null, null)).toBeNull();
  });

  it('matches by orderId', () => {
    expect(resolveDeepLinkRow(rows, 'o1', null)?.orderId).toBe('o1');
  });

  it('matches by bufferId', () => {
    expect(resolveDeepLinkRow(rows, null, 'b1')?.bufferId).toBe('b1');
  });

  it('returns null when the id is not in the feed', () => {
    expect(resolveDeepLinkRow(rows, 'missing', null)).toBeNull();
  });
});
