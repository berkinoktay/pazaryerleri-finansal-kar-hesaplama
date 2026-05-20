import { describe, expect, it } from 'vitest';

import { mapTrendyolStatusToEnum } from '@pazarsync/marketplace';

/**
 * 13 Trendyol status × 6 PazarSync OrderStatus mapping (Order Sync design §2b).
 *
 * Webhook subscribe API uses UPPERCASE values (`CREATED`, `PICKING`, …).
 * getShipmentPackages REST response uses Title-Case (`Created`, `Picking`, …).
 * mapTrendyolStatusToEnum normalizes via .toUpperCase() so both call sites
 * use the same function. Unknown → null; caller decides fallback policy.
 */
describe('mapTrendyolStatusToEnum — 13 statuses → 6 enum', () => {
  it.each([
    ['CREATED', 'PENDING'],
    ['AWAITING', 'PENDING'],
    ['PICKING', 'PROCESSING'],
    ['INVOICED', 'PROCESSING'],
    ['UNPACKED', 'PROCESSING'],
    ['VERIFIED', 'PROCESSING'],
    ['SHIPPED', 'SHIPPED'],
    ['UNDELIVERED', 'SHIPPED'],
    ['AT_COLLECTION_POINT', 'SHIPPED'],
    ['DELIVERED', 'DELIVERED'],
    ['CANCELLED', 'CANCELLED'],
    ['UNSUPPLIED', 'CANCELLED'],
    ['RETURNED', 'RETURNED'],
  ])('UPPERCASE %s → %s', (input, expected) => {
    expect(mapTrendyolStatusToEnum(input)).toBe(expected);
  });

  it.each([
    ['Created', 'PENDING'],
    ['Picking', 'PROCESSING'],
    ['Invoiced', 'PROCESSING'],
    ['Shipped', 'SHIPPED'],
    ['UnDelivered', 'SHIPPED'],
    ['Delivered', 'DELIVERED'],
    ['Returned', 'RETURNED'],
    ['Cancelled', 'CANCELLED'],
  ])('Title-Case %s → %s (getShipmentPackages REST form)', (input, expected) => {
    expect(mapTrendyolStatusToEnum(input)).toBe(expected);
  });

  it('AtCollectionPoint (Title-Case) also maps to SHIPPED', () => {
    expect(mapTrendyolStatusToEnum('AtCollectionPoint')).toBe('SHIPPED');
  });

  it('returns null for unknown status (forward-compat fallback)', () => {
    expect(mapTrendyolStatusToEnum('EXOTIC_NEW_STATUS')).toBeNull();
    expect(mapTrendyolStatusToEnum('Pending')).toBeNull();
    expect(mapTrendyolStatusToEnum('')).toBeNull();
  });
});
