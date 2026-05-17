/**
 * Unit tests for `hasFastDeliverySetup` — pure function, no I/O.
 *
 * Covers the three "fast delivery" indicators a variant exposes:
 *   1. `deliveryDuration` ≤ carrier max → eligible
 *   2. `isRushDelivery: true` (independent of duration) → eligible
 *   3. `fastDeliveryOptions` non-empty (independent of the other two) → eligible
 *
 * Plus the negative cases: nothing qualifies; null duration with no other
 * indicators. See spec §5.2 and plan Task 2.2.
 */

import { describe, expect, it } from 'vitest';

import { hasFastDeliverySetup } from '../shipping-estimator.service';

describe('hasFastDeliverySetup', () => {
  const carrier = { maxBaremEligibleDeliveryDuration: 1 };

  it('returns true when deliveryDuration is within the carrier max', () => {
    const variant = {
      deliveryDuration: 1,
      isRushDelivery: false,
      fastDeliveryOptions: [],
    };
    expect(hasFastDeliverySetup(variant, carrier)).toBe(true);
  });

  it('returns true when isRushDelivery is true even with a too-long deliveryDuration', () => {
    const variant = {
      deliveryDuration: 5,
      isRushDelivery: true,
      fastDeliveryOptions: [],
    };
    expect(hasFastDeliverySetup(variant, carrier)).toBe(true);
  });

  it('returns true when fastDeliveryOptions is non-empty and no other indicators apply', () => {
    const variant = {
      deliveryDuration: 5,
      isRushDelivery: false,
      fastDeliveryOptions: ['Today'],
    };
    expect(hasFastDeliverySetup(variant, carrier)).toBe(true);
  });

  it('returns false when nothing qualifies', () => {
    const variant = {
      deliveryDuration: 5,
      isRushDelivery: false,
      fastDeliveryOptions: [],
    };
    expect(hasFastDeliverySetup(variant, carrier)).toBe(false);
  });

  it('returns false when deliveryDuration is null and no other indicators apply', () => {
    const variant = {
      deliveryDuration: null,
      isRushDelivery: false,
      fastDeliveryOptions: [],
    };
    expect(hasFastDeliverySetup(variant, carrier)).toBe(false);
  });
});
