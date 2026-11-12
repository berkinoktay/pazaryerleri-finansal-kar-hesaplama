/**
 * Unit tests for `hasFastDeliverySetup` - pure function, no I/O.
 *
 * Barem eligibility reads one signal: the variant's `deliveryDuration`
 * (Trendyol: 0 = ships today, 1 = ships by tomorrow) must be set and within
 * the carrier's `maxBaremEligibleDeliveryDuration`. Trendyol stopped sending
 * the rush-delivery flag and the fast-delivery option list in August 2026, so
 * neither is part of the input any more.
 */

import { describe, expect, it } from 'vitest';

import { hasFastDeliverySetup } from '@/services/shipping-estimator.service';

describe('hasFastDeliverySetup', () => {
  const carrier = { maxBaremEligibleDeliveryDuration: 1 };

  it('returns true when deliveryDuration is 0 (ships today)', () => {
    expect(hasFastDeliverySetup({ deliveryDuration: 0 }, carrier)).toBe(true);
  });

  it('returns true when deliveryDuration equals the carrier max', () => {
    expect(hasFastDeliverySetup({ deliveryDuration: 1 }, carrier)).toBe(true);
  });

  it('returns false when deliveryDuration is one day above the carrier max', () => {
    expect(hasFastDeliverySetup({ deliveryDuration: 2 }, carrier)).toBe(false);
  });

  it('returns false when deliveryDuration is null', () => {
    expect(hasFastDeliverySetup({ deliveryDuration: null }, carrier)).toBe(false);
  });

  it('uses the carrier window rather than a fixed threshold', () => {
    const twoDayCarrier = { maxBaremEligibleDeliveryDuration: 2 };
    expect(hasFastDeliverySetup({ deliveryDuration: 2 }, twoDayCarrier)).toBe(true);
  });
});
